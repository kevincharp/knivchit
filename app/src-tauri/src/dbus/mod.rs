use std::collections::HashMap;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::StreamExt;
use sqlx::SqlitePool;
use zbus::message::Header;
use zbus::zvariant::OwnedValue;
use zbus::{fdo, interface, proxy, Connection};

use crate::db;

/// Servicio `org.knivchit.App` en `/org/knivchit/App`.
///
/// `on_start_capture` es un callback opaco en vez de un `tauri::AppHandle`
/// directo — así `AppService` no depende de tipos de Tauri (que son
/// genéricos sobre el runtime) y sigue siendo trivial de testear con un
/// closure de prueba, ver `tests/dbus_contract.rs`.
pub struct AppService {
    pub visible: Arc<AtomicBool>,
    pub on_start_capture: Arc<dyn Fn() + Send + Sync>,
    /// Callback de `ShowMain`: igual que `on_start_capture`, opaco a propósito
    /// para no acoplar `AppService` a tipos de Tauri.
    pub on_show_main: Arc<dyn Fn() + Send + Sync>,
    /// Quién puede llamar a `StartCapture` y `ShowMain`.
    pub trust: CallerTrust,
}

/// Lo que el bus y `/proc` dicen de quien llama.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerInfo {
    pub uid: Option<u32>,
    /// Nombre del ejecutable (`/proc/<pid>/exe`), sin ruta ni «(deleted)».
    pub exe_name: Option<String>,
    /// El ejecutable es propiedad de root y no lo puede escribir nadie más
    /// (`false` si no se pudo comprobar). Se exige a `gnome-shell`.
    pub exe_root_owned: bool,
}

/// Propietario root y sin permiso de escritura para grupo ni otros. Un binario
/// que el propio usuario pueda crear o modificar no acredita ser el Shell.
pub fn is_root_owned_and_locked(uid: u32, mode: u32) -> bool {
    uid == 0 && mode & 0o022 == 0
}

/// Lo comprueba sobre `/proc/<pid>/exe` (el inodo REAL en ejecución, aunque el
/// archivo se haya reemplazado o borrado). Cualquier fallo cuenta como `false`:
/// ante la duda se deniega.
fn exe_is_root_owned(pid: u32) -> bool {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(format!("/proc/{pid}/exe"))
        .map(|m| is_root_owned_and_locked(m.uid(), m.mode()))
        .unwrap_or(false)
}

/// Política de confianza de los métodos de `org.knivchit.App`. Sin ella
/// cualquier proceso de la sesión podría disparar la captura con el permiso
/// que el portal concede a Knivchit (confused deputy).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallerTrust {
    /// Solo el mismo usuario y, según el método, un ejecutable concreto.
    Enforced { my_uid: u32, my_exe_name: String },
    /// Sin comprobación: únicamente para los tests con un bus privado.
    AllowAny,
}

/// Quién puede llamar a un método: `gnome-shell` (la extensión corre DENTRO
/// del Shell) y/o una instancia de Knivchit (mismo nombre de binario, también
/// desde un AppImage montado en otra ruta). Siempre con el mismo UID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Callers {
    pub shell: bool,
    pub own_binary: bool,
}

/// `StartCapture`: solo la extensión (atajo global).
pub const START_CAPTURE_CALLERS: Callers = Callers { shell: true, own_binary: false };
/// `ShowMain`: la extensión (clic en el icono de la barra superior) y una
/// segunda instancia de Knivchit (instancia única).
pub const SHOW_MAIN_CALLERS: Callers = Callers { shell: true, own_binary: true };

const SHELL_EXE: &str = "gnome-shell";

impl CallerTrust {
    /// Política de producción: UID y ejecutable propios.
    pub fn enforced_for_this_process() -> Self {
        use std::os::unix::fs::MetadataExt;
        let my_uid = std::fs::metadata("/proc/self").map(|m| m.uid()).unwrap_or(u32::MAX);
        let my_exe_name = std::env::current_exe()
            .ok()
            .and_then(|p| exe_name_of(&p))
            .unwrap_or_default();
        CallerTrust::Enforced { my_uid, my_exe_name }
    }

    pub fn allows(&self, peer: &PeerInfo, callers: Callers) -> bool {
        match self {
            CallerTrust::AllowAny => true,
            CallerTrust::Enforced { my_uid, my_exe_name } => {
                peer.uid == Some(*my_uid)
                    && peer.exe_name.as_deref().is_some_and(|name| {
                        // gnome-shell: además de llamarse así, su ejecutable debe ser de
                        // root y no escribible (un binario del usuario con ese nombre no vale).
                        (callers.shell && name == SHELL_EXE && peer.exe_root_owned)
                            || (callers.own_binary && !my_exe_name.is_empty() && name == my_exe_name)
                    })
            }
        }
    }
}

/// Nombre de un ejecutable sin ruta ni el « (deleted)» que `/proc` añade si
/// el binario se reemplazó mientras corría.
pub fn exe_name_of(path: &std::path::Path) -> Option<String> {
    let name = path.file_name()?.to_str()?;
    Some(name.strip_suffix(" (deleted)").unwrap_or(name).to_string())
}

/// Credenciales de quien envió el mensaje: UID y PID los da el daemon del bus
/// (`GetConnectionCredentials`, no falsificables por el cliente); el nombre
/// del ejecutable sale de `/proc/<pid>/exe` (falla entre namespaces de PID,
/// p. ej. Flatpak: entonces se deniega).
async fn peer_info(connection: &Connection, header: &Header<'_>) -> Option<PeerInfo> {
    let sender = header.sender()?.clone();
    let proxy = fdo::DBusProxy::new(connection).await.ok()?;
    let creds = proxy
        .get_connection_credentials(zbus::names::BusName::Unique(sender))
        .await
        .ok()?;
    let pid = creds.process_id();
    let exe_name = pid
        .and_then(|pid| std::fs::read_link(format!("/proc/{pid}/exe")).ok())
        .and_then(|p| exe_name_of(&p));
    let exe_root_owned = pid.is_some_and(exe_is_root_owned);
    Some(PeerInfo { uid: creds.unix_user_id(), exe_name, exe_root_owned })
}

async fn authorize(
    trust: &CallerTrust,
    connection: &Connection,
    header: &Header<'_>,
    callers: Callers,
    method: &str,
) -> fdo::Result<()> {
    if *trust == CallerTrust::AllowAny {
        return Ok(());
    }
    let allowed_peer = match peer_info(connection, header).await {
        Some(peer) => trust.allows(&peer, callers),
        None => false,
    };
    if allowed_peer {
        Ok(())
    } else {
        // Sin datos del llamante en el mensaje de error ni en el log.
        eprintln!("knivchit: llamada a {method} rechazada (llamante no autorizado)");
        Err(fdo::Error::AccessDenied(format!(
            "{method}: Knivchit no pudo comprobar que la llamada viene de la extensión de GNOME \
             del mismo usuario (o de otra instancia de Knivchit); se ignora"
        )))
    }
}

#[interface(name = "org.knivchit.App")]
impl AppService {
    /// RESERVADO para el panel flotante del historial (aún no existe): hoy solo
    /// invierte un flag interno, sin ventana ni callback conectados, y la
    /// extensión ya no lo llama. Se conserva en el contrato a propósito; al
    /// construir el panel se sustituye por un callback `on_toggle_popup` que
    /// mire `is_visible()` (el estado lo decide la app mirando su ventana, nunca
    /// un parámetro que mande la extensión).
    async fn toggle_popup(&self) {
        let prev = self.visible.load(Ordering::SeqCst);
        self.visible.store(!prev, Ordering::SeqCst);
    }

    /// Lo llama la extensión GNOME cuando se dispara el atajo global de
    /// captura (`Main.wm.addKeybinding`) — dispara el mismo flujo que el
    /// botón de la ventana principal, sin necesitar que esa ventana exista.
    async fn start_capture(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<()> {
        authorize(&self.trust, connection, &header, START_CAPTURE_CALLERS, "StartCapture")
            .await?;
        (self.on_start_capture)();
        Ok(())
    }

    /// Lo llama una segunda instancia al arrancar (instancia única) para que
    /// la viva muestre su ventana principal — la crea si estaba cerrada.
    async fn show_main(
        &self,
        #[zbus(header)] header: Header<'_>,
        #[zbus(connection)] connection: &Connection,
    ) -> fdo::Result<()> {
        authorize(&self.trust, connection, &header, SHOW_MAIN_CALLERS, "ShowMain").await?;
        (self.on_show_main)();
        Ok(())
    }
}

/// Cliente del servicio `org.knivchit.ClipboardService` que expone la
/// extensión GNOME. La app es cliente acá, aunque también sea servidor de
/// `org.knivchit.App` — son dos roles distintos sobre el mismo bus.
#[proxy(
    interface = "org.knivchit.ClipboardService",
    default_service = "org.knivchit.ClipboardService",
    default_path = "/org/knivchit/ClipboardService"
)]
trait ClipboardService {
    #[zbus(signal)]
    fn history_changed(&self, entry: HashMap<String, OwnedValue>) -> zbus::Result<()>;
}

/// Conecta al bus de sesión REAL, registra `org.knivchit.App` (servidor) y
/// se queda suscrito a `HistoryChanged` (cliente) — este es el punto de
/// entrada que faltaba conectar desde `lib.rs::run()`; hasta ahora ambos
/// lados del contrato D-Bus solo se ejercitaban en tests de integración
/// contra un bus privado, nunca en la app real. Corre indefinidamente.
pub async fn serve_app_and_subscribe(
    service: AppService,
    pool: SqlitePool,
    cap_count: i64,
) -> zbus::Result<()> {
    let connection = zbus::connection::Builder::session()?
        .name("org.knivchit.App")?
        .serve_at("/org/knivchit/App", service)?
        .build()
        .await?;

    subscribe_to_clipboard_changes(&connection, pool, cap_count).await
}

/// Tipos de contenido que acepta el historial (igual que el `CHECK` de SQL).
const CONTENT_TYPES: [&str; 3] = ["text", "image", "link"];
/// Tope de `content` para texto y enlaces.
pub const MAX_TEXT_BYTES: usize = 1024 * 1024;
/// Tope de `content` para imágenes.
pub const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
/// Tope de `source_app`; uno más largo se trata como ausente (NULL).
pub const MAX_SOURCE_APP_BYTES: usize = 256;

/// Decide si una entrada de `HistoryChanged` se guarda. `None` = descartar;
/// `Some(source_app)` = guardar con el `source_app` ya saneado. Nunca registra
/// el contenido.
pub fn accept_entry(
    content_type: &str,
    content: &str,
    source_app: Option<String>,
) -> Option<Option<String>> {
    if !CONTENT_TYPES.contains(&content_type) {
        return None;
    }
    let max = if content_type == "image" { MAX_IMAGE_BYTES } else { MAX_TEXT_BYTES };
    if content.is_empty() || content.len() > max {
        return None;
    }
    Some(source_app.filter(|s| !s.is_empty() && s.len() <= MAX_SOURCE_APP_BYTES))
}

/// RESERVADO: la extensión aún no emite `HistoryChanged` (su TODO de
/// `St.Clipboard` sigue abierto), así que hoy esta suscripción no recibe nada.
///
/// Se suscribe a `HistoryChanged` y persiste cada entrada.
/// Corre indefinidamente; el caller la spawnea como una tarea de
/// fondo separada.
pub async fn subscribe_to_clipboard_changes(
    connection: &Connection,
    pool: SqlitePool,
    cap_count: i64,
) -> zbus::Result<()> {
    let proxy = ClipboardServiceProxy::new(connection).await?;
    let mut stream = proxy.receive_history_changed().await?;

    while let Some(signal) = stream.next().await {
        let args = match signal.args() {
            Ok(args) => args,
            Err(_) => continue,
        };
        let entry = args.entry;

        let content_type = entry
            .get("content_type")
            .and_then(|v| String::try_from(v.clone()).ok());
        let content = entry
            .get("content")
            .and_then(|v| String::try_from(v.clone()).ok());
        let source_app = entry
            .get("source_app")
            .and_then(|v| String::try_from(v.clone()).ok());

        // HistoryChanged puede llegar sin source_app — se trata como NULL,
        // nunca como error.
        if let (Some(content_type), Some(content)) = (content_type, content) {
            // Cualquier proceso de la sesión puede reclamar el nombre del bus
            // si la extensión no está activa: se descarta lo que no cumple.
            let Some(source_app) = accept_entry(&content_type, &content, source_app) else {
                continue;
            };
            let _ = db::insert_clipboard_entry(&pool, &content_type, &content, source_app.as_deref())
                .await;
            let _ = db::evict_clipboard_history(&pool, cap_count).await;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(uid: u32, exe: &str) -> PeerInfo {
        PeerInfo { uid: Some(uid), exe_name: Some(exe.to_string()), exe_root_owned: true }
    }

    fn enforced() -> CallerTrust {
        CallerTrust::Enforced { my_uid: 1000, my_exe_name: "knivchit".into() }
    }

    #[test]
    fn start_capture_only_from_gnome_shell_of_the_same_user() {
        let t = enforced();
        assert!(t.allows(&peer(1000, "gnome-shell"), START_CAPTURE_CALLERS));
        assert!(!t.allows(&peer(1000, "python3"), START_CAPTURE_CALLERS));
        assert!(!t.allows(&peer(1000, "knivchit"), START_CAPTURE_CALLERS));
        assert!(!t.allows(&peer(1001, "gnome-shell"), START_CAPTURE_CALLERS));
    }

    #[test]
    fn a_user_owned_binary_named_gnome_shell_is_denied_for_both_methods() {
        let t = enforced();
        let impostor = PeerInfo { uid: Some(1000), exe_name: Some("gnome-shell".into()), exe_root_owned: false };
        assert!(!t.allows(&impostor, START_CAPTURE_CALLERS));
        assert!(!t.allows(&impostor, SHOW_MAIN_CALLERS));
        // el propio binario no necesita ser de root (puede ir en un AppImage del usuario)
        let own = PeerInfo { uid: Some(1000), exe_name: Some("knivchit".into()), exe_root_owned: false };
        assert!(t.allows(&own, SHOW_MAIN_CALLERS));
    }

    #[test]
    fn only_root_owned_non_writable_executables_are_trusted() {
        assert!(is_root_owned_and_locked(0, 0o755));
        assert!(is_root_owned_and_locked(0, 0o555));
        assert!(!is_root_owned_and_locked(1000, 0o755), "de un usuario");
        assert!(!is_root_owned_and_locked(0, 0o775), "escribible por el grupo");
        assert!(!is_root_owned_and_locked(0, 0o757), "escribible por otros");
    }

    #[test]
    fn real_executables_are_classified_by_their_actual_inode() {
        // /proc/self/exe es este binario de test, compilado por el usuario: no es de root
        assert!(!exe_is_root_owned(std::process::id()));
        // un proceso inexistente nunca se acredita
        assert!(!exe_is_root_owned(u32::MAX));
        // el init del sistema sí es de root y no escribible
        if fs::metadata("/proc/1/exe").is_ok() {
            assert!(exe_is_root_owned(1));
        }
    }

    #[test]
    fn show_main_from_gnome_shell_or_another_knivchit_of_the_same_user() {
        let t = enforced();
        assert!(t.allows(&peer(1000, "knivchit"), SHOW_MAIN_CALLERS));
        // el clic del icono de la barra superior lo envía el Shell
        assert!(t.allows(&peer(1000, "gnome-shell"), SHOW_MAIN_CALLERS));
        assert!(!t.allows(&peer(1001, "gnome-shell"), SHOW_MAIN_CALLERS));
        assert!(!t.allows(&peer(1000, "python3"), SHOW_MAIN_CALLERS));
        assert!(!t.allows(&peer(1000, "bash"), SHOW_MAIN_CALLERS));
        assert!(!t.allows(&peer(0, "knivchit"), SHOW_MAIN_CALLERS));
    }

    #[test]
    fn unknown_credentials_are_denied_and_allow_any_is_explicit() {
        let t = enforced();
        let nobody = PeerInfo { uid: None, exe_name: None, exe_root_owned: false };
        let no_exe = PeerInfo { uid: Some(1000), exe_name: None, exe_root_owned: true };
        assert!(!t.allows(&nobody, START_CAPTURE_CALLERS));
        assert!(!t.allows(&no_exe, START_CAPTURE_CALLERS));
        // un nombre de binario propio vacío nunca autoriza ShowMain
        let sin_nombre = CallerTrust::Enforced { my_uid: 1000, my_exe_name: String::new() };
        assert!(!sin_nombre.allows(&peer(1000, ""), SHOW_MAIN_CALLERS));
        assert!(CallerTrust::AllowAny.allows(&nobody, SHOW_MAIN_CALLERS));
    }

    #[test]
    fn appimage_mount_paths_are_compared_by_file_name_not_full_path() {
        use std::path::Path;
        let t = enforced();
        for mount in ["/tmp/.mount_KnivchAbC123/usr/bin/knivchit", "/tmp/.mount_KnivchZzZ999/usr/bin/knivchit (deleted)"] {
            let name = exe_name_of(Path::new(mount)).unwrap();
            assert!(t.allows(&peer(1000, &name), SHOW_MAIN_CALLERS), "{mount}");
        }
    }

    #[test]
    fn exe_name_ignores_path_and_deleted_suffix() {
        use std::path::Path;
        assert_eq!(exe_name_of(Path::new("/usr/bin/gnome-shell")).as_deref(), Some("gnome-shell"));
        assert_eq!(
            exe_name_of(Path::new("/tmp/.mount_KnivchXY/usr/bin/knivchit (deleted)")).as_deref(),
            Some("knivchit")
        );
    }

    #[test]
    fn accepts_known_types_within_limits() {
        for t in ["text", "link", "image"] {
            assert_eq!(accept_entry(t, "x", None), Some(None), "{t}");
        }
        assert_eq!(accept_entry("text", "x", Some("firefox".into())), Some(Some("firefox".into())));
    }

    #[test]
    fn rejects_unknown_type_empty_and_oversized_content() {
        assert!(accept_entry("video", "x", None).is_none());
        assert!(accept_entry("text", "", None).is_none());
        assert!(accept_entry("text", &"a".repeat(MAX_TEXT_BYTES + 1), None).is_none());
        assert!(accept_entry("link", &"a".repeat(MAX_TEXT_BYTES + 1), None).is_none());
        assert!(accept_entry("image", &"a".repeat(MAX_TEXT_BYTES + 1), None).is_some());
        assert!(accept_entry("image", &"a".repeat(MAX_IMAGE_BYTES + 1), None).is_none());
    }

    #[test]
    fn oversized_or_empty_source_app_becomes_null_not_an_error() {
        assert_eq!(accept_entry("text", "x", Some("a".repeat(MAX_SOURCE_APP_BYTES + 1))), Some(None));
        assert_eq!(accept_entry("text", "x", Some(String::new())), Some(None));
    }
}
