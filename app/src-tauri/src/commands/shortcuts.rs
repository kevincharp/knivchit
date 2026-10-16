//! Atajos de teclado configurables (Ajustes). Knivchit no fija
//! ninguno por defecto: la EXTENSIÓN GNOME es la dueña (los guarda en su
//! GSettings y los (re)liga en vivo) y la app los lee y cambia por D-Bus
//! (`org.knivchit.ClipboardService`: `GetShortcuts`, `SetShortcut`,
//! `CheckConflicts`). Aquí vive el cliente zbus y la validación previa: nada
//! llega a la extensión sin pasar por ella.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::Serialize;
use zbus::{proxy, Connection};

use super::hub::name_has_owner;

pub(super) const EXTENSION_BUS_NAME: &str = "org.knivchit.ClipboardService";

/// Error estable que devuelven `set_shortcut` y `check_shortcut_conflicts`
/// cuando la extensión no está activa: el frontend lo reconoce y explica cómo
/// activarla.
pub const EXTENSION_INACTIVE_ERROR: &str = "extension_inactive";

/// Error estable cuando la extensión cargada es una versión vieja que no
/// conoce los métodos de atajos (p. ej. se instaló la nueva pero no se reinició
/// la sesión): el frontend dice «Reinicia la sesión para cargar la extensión
/// actualizada» en vez de un fallo genérico.
pub const EXTENSION_OUTDATED_ERROR: &str = "extension_outdated";

/// Error estable cuando la extensión rechaza a la app (`AccessDenied`, EXT-01:
/// solo atiende al proceso que posee `org.knivchit.App`) — «atajos no
/// disponibles», distinto de «extensión inactiva» porque activarla no lo arregla.
pub const SHORTCUTS_UNAVAILABLE_ERROR: &str = "shortcuts_unavailable";

/// Nombre que ve el usuario (también el título de la ventana que la extensión
/// exige enfocada para grabar). Una sola constante para el renombrado.
pub const APP_DISPLAY_NAME: &str = "Knivchit";

const MAX_ACCEL_LEN: usize = 64;
const MAX_KEY_LEN: usize = 32;
const MAX_REMOTE_ERROR_LEN: usize = 200;

const UNKNOWN_MEMBER_ERROR_NAMES: [&str; 3] = [
    "org.freedesktop.DBus.Error.UnknownMethod",
    "org.freedesktop.DBus.Error.UnknownObject",
    "org.freedesktop.DBus.Error.UnknownInterface",
];

/// `true` si la extensión rechazó la llamada por no ser quien debe llamar.
pub(super) fn is_access_denied(error: &zbus::Error) -> bool {
    match error {
        zbus::Error::MethodError(name, _, _) => {
            name.as_str() == "org.freedesktop.DBus.Error.AccessDenied"
        }
        zbus::Error::FDO(inner) => matches!(**inner, zbus::fdo::Error::AccessDenied(_)),
        _ => false,
    }
}

/// `true` si el error indica que el método, el objeto o la interfaz no
/// existen en quien responde: una extensión anterior a los atajos.
fn is_unknown_member(error: &zbus::Error) -> bool {
    match error {
        zbus::Error::MethodError(name, _, _) => UNKNOWN_MEMBER_ERROR_NAMES.contains(&name.as_str()),
        zbus::Error::InterfaceNotFound => true,
        zbus::Error::FDO(inner) => matches!(
            **inner,
            zbus::fdo::Error::UnknownMethod(_)
                | zbus::fdo::Error::UnknownObject(_)
                | zbus::fdo::Error::UnknownInterface(_)
        ),
        _ => false,
    }
}

/// Texto de error para el frontend: el estable `extension_outdated` si la
/// extensión no conoce el método, o el genérico `generic`.
pub(super) fn call_error(error: &zbus::Error, generic: &str) -> String {
    if is_access_denied(error) {
        SHORTCUTS_UNAVAILABLE_ERROR.to_string()
    } else if is_unknown_member(error) {
        EXTENSION_OUTDATED_ERROR.to_string()
    } else {
        generic.to_string()
    }
}

#[proxy(
    interface = "org.knivchit.ClipboardService",
    default_service = "org.knivchit.ClipboardService",
    default_path = "/org/knivchit/ClipboardService"
)]
trait ExtensionShortcuts {
    fn get_shortcuts(&self) -> zbus::Result<HashMap<String, String>>;
    fn set_shortcut(&self, action: &str, accel: &str) -> zbus::Result<(bool, String)>;
    fn check_conflicts(&self, accel: &str) -> zbus::Result<Vec<String>>;
    fn record_shortcut(&self) -> zbus::Result<(String, String)>;
}

/// Acciones a las que se puede asignar un atajo (lista cerrada). Hoy solo
/// «capture»; el panel de emojis y el de portapapeles se añadirán aquí.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutAction {
    Capture,
}

impl ShortcutAction {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "capture" => Ok(Self::Capture),
            _ => Err("acción de atajo desconocida".to_string()),
        }
    }

    /// Nombre de la acción en el contrato D-Bus con la extensión.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Capture => "capture",
        }
    }
}

/// Modificadores que acepta la extensión (sin importar mayúsculas); `<Mod4>`
/// y similares NO.
const MODIFIERS: [&str; 7] = ["shift", "control", "ctrl", "primary", "alt", "super", "hyper"];
const EXTRA_MODIFIER: &str = "meta";

fn is_function_key(key: &str) -> bool {
    key.strip_prefix(['F', 'f'])
        .and_then(|n| n.parse::<u8>().ok())
        .is_some_and(|n| (1..=35).contains(&n))
        && !key[1..].starts_with('0')
}

/// Valida un acelerador en formato GTK (`<Super><Shift>c`, `F9`): cero o más
/// modificadores entre `<>` seguidos de UNA tecla (nombre de keysym:
/// `[A-Za-z0-9_]`), con al menos un modificador DISTINTO de Shift salvo para
/// las teclas F1–F35 (`<Shift>c` secuestraría la escritura; `<Shift>F9` vale).
/// Las mismas reglas que aplica la extensión, que además comprueba que la
/// tecla exista.
/// Acotado en longitud y sin NUL, saltos de línea ni otros caracteres de
/// control. Devuelve el acelerador tal cual (la extensión lo normaliza).
pub fn validate_accel(accel: &str) -> Result<&str, String> {
    if accel.is_empty() {
        return Err("el atajo no puede estar vacío".to_string());
    }
    if accel.len() > MAX_ACCEL_LEN {
        return Err("el atajo es demasiado largo".to_string());
    }
    if accel.chars().any(char::is_control) {
        return Err("el atajo contiene caracteres de control".to_string());
    }

    let mut rest = accel;
    let mut non_shift_modifiers = 0usize;
    while let Some(after) = rest.strip_prefix('<') {
        let end = after
            .find('>')
            .ok_or_else(|| "el atajo tiene un modificador sin cerrar".to_string())?;
        let name = after[..end].to_ascii_lowercase();
        if !MODIFIERS.contains(&name.as_str()) && name != EXTRA_MODIFIER {
            return Err("el atajo usa un modificador desconocido".to_string());
        }
        if name != "shift" {
            non_shift_modifiers += 1;
        }
        rest = &after[end + 1..];
    }

    let key_ok = !rest.is_empty()
        && rest.len() <= MAX_KEY_LEN
        && rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !key_ok {
        return Err("el atajo no tiene una tecla válida".to_string());
    }
    if non_shift_modifiers == 0 && !is_function_key(rest) {
        return Err("el atajo necesita un modificador (Ctrl, Alt o Super) salvo en las teclas F".to_string());
    }
    Ok(accel)
}

/// Para `SetShortcut`: vacío o solo espacios significa «quitar el atajo» (se
/// envía `""`); todo lo demás debe ser un acelerador válido.
pub fn validate_accel_or_clear(accel: &str) -> Result<&str, String> {
    if accel.trim().is_empty() {
        Ok("")
    } else {
        validate_accel(accel)
    }
}

/// Recorta el mensaje de error que devuelve la extensión (dato externo).
pub(super) fn bounded_remote_error(error: &str) -> String {
    let error: String = error.chars().filter(|c| !c.is_control()).collect();
    if error.is_empty() {
        "la extensión rechazó el atajo".to_string()
    } else {
        error.chars().take(MAX_REMOTE_ERROR_LEN).collect()
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ShortcutsInfo {
    pub extension_active: bool,
    pub shortcuts: HashMap<String, String>,
}

/// Solo las acciones conocidas: lo que la extensión añada en el futuro no se
/// filtra al frontend hasta que la lista cerrada de aquí lo contemple.
fn known_shortcuts(raw: HashMap<String, String>) -> HashMap<String, String> {
    raw.into_iter()
        .filter(|(action, _)| ShortcutAction::parse(action).is_ok())
        .collect()
}

pub async fn get_shortcuts_on(connection: &Connection) -> Result<ShortcutsInfo, String> {
    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Ok(ShortcutsInfo { extension_active: false, shortcuts: HashMap::new() });
    }
    let proxy = ExtensionShortcutsProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    let shortcuts = match proxy.get_shortcuts().await {
        Ok(shortcuts) => shortcuts,
        // «Atajos no disponibles»: sin error, igual que sin extensión, para que
        // la interfaz no ofrezca asignar ni grabar.
        Err(e) if is_access_denied(&e) => {
            return Ok(ShortcutsInfo { extension_active: false, shortcuts: HashMap::new() })
        }
        Err(e) => return Err(call_error(&e, "no se pudieron leer los atajos")),
    };
    Ok(ShortcutsInfo { extension_active: true, shortcuts: known_shortcuts(shortcuts) })
}

pub async fn set_shortcut_on(
    connection: &Connection,
    action: &str,
    accel: &str,
) -> Result<(), String> {
    let action = ShortcutAction::parse(action)?;
    let accel = validate_accel_or_clear(accel)?;
    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Err(EXTENSION_INACTIVE_ERROR.to_string());
    }
    let proxy = ExtensionShortcutsProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    let (ok, error) = proxy
        .set_shortcut(action.as_str(), accel)
        .await
        .map_err(|e| call_error(&e, "no se pudo asignar el atajo"))?;
    if ok {
        Ok(())
    } else {
        Err(bounded_remote_error(&error))
    }
}

pub async fn check_conflicts_on(connection: &Connection, accel: &str) -> Result<Vec<String>, String> {
    let accel = validate_accel(accel)?;
    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Err(EXTENSION_INACTIVE_ERROR.to_string());
    }
    let proxy = ExtensionShortcutsProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    let conflicts = proxy
        .check_conflicts(accel)
        .await
        .map_err(|e| call_error(&e, "no se pudieron comprobar los conflictos"))?;
    Ok(conflicts.into_iter().map(|c| bounded_remote_error(&c)).collect())
}

/// La extensión espera ~12 s a que el usuario pulse la combinación
/// (`DEFAULT_TIMEOUT_MS` en `extension/lib/shortcutRecorder.js`); la llamada
/// D-Bus debe durar más que eso para recibir su `timeout`, y 20 s deja margen.
pub const RECORD_CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// Resultado de una grabación, con variantes estables para el frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordStatus {
    Ok,
    Cancelled,
    Timeout,
    Busy,
    Invalid,
    /// El Shell no concede el grab de teclado y ratón.
    Unavailable,
}

impl RecordStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::Busy => "busy",
            Self::Invalid => "invalid",
            Self::Unavailable => "unavailable",
        }
    }

    /// Un estado que la extensión no conoce se trata como `invalid`.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "ok" => Self::Ok,
            "cancelled" => Self::Cancelled,
            "timeout" => Self::Timeout,
            "busy" => Self::Busy,
            "unavailable" => Self::Unavailable,
            _ => Self::Invalid,
        }
    }
}

/// `accel` solo viene con `ok`; `message` solo con `invalid` (el motivo legible
/// que da la extensión, ya recortado) y está vacío en los demás estados.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RecordedShortcut {
    pub accel: String,
    pub status: String,
    pub message: String,
}

fn recorded(status: RecordStatus, accel: &str, message: &str) -> RecordedShortcut {
    RecordedShortcut {
        accel: accel.to_string(),
        status: status.as_str().to_string(),
        message: message.to_string(),
    }
}

/// Convierte la respuesta de la extensión: solo con `ok` se entrega un
/// acelerador, y únicamente si pasa `validate_accel`. Con `invalid` el campo
/// `accel` de la extensión lleva el MOTIVO, que se entrega como `message`.
pub fn interpret_record_reply(accel: &str, status: &str) -> RecordedShortcut {
    match RecordStatus::parse(status) {
        RecordStatus::Ok => match validate_accel(accel) {
            Ok(valid) => recorded(RecordStatus::Ok, valid, ""),
            Err(reason) => recorded(RecordStatus::Invalid, "", &reason),
        },
        RecordStatus::Invalid => {
            recorded(RecordStatus::Invalid, "", &bounded_remote_error(accel))
        }
        RecordStatus::Unavailable => unavailable(),
        other => recorded(other, "", ""),
    }
}

/// Libera la marca de «grabación en curso» al salir, también ante un error.
struct InFlight<'a>(&'a AtomicBool);

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// La extensión responde `busy` durante 750 ms tras terminar una grabación;
/// un reintento inmediato (Esc y volver a pulsar «Grabar») lo recibe. Se espera
/// un poco más que eso y se reintenta una vez, sin que la interfaz lo note.
pub const BUSY_RETRY_DELAY: Duration = Duration::from_millis(800);

/// Mensaje de `unavailable` (la extensión lo devuelve si la sesión está
/// bloqueada, si la ventana enfocada no es la de Knivchit o si otro modal
/// tiene el teclado).
fn unavailable_message() -> String {
    format!(
        "No se puede grabar ahora: {APP_DISPLAY_NAME} debe ser la ventana activa, sin la sesión \
         bloqueada ni otro diálogo del sistema abierto."
    )
}

fn unavailable() -> RecordedShortcut {
    recorded(RecordStatus::Unavailable, "", &unavailable_message())
}

/// Pide a la extensión que grabe un atajo (grab modal del Shell). Solo una
/// grabación a la vez (`in_flight`): otra concurrente da `busy` sin llamar.
/// Sin extensión: `extension_inactive`, también si desaparece a mitad de la
/// llamada. Pasado `timeout` sin respuesta: `timeout`. Un `busy` inmediato de
/// la extensión (cooldown) se reintenta una vez tras `BUSY_RETRY_DELAY`; si
/// sigue `busy`, se entrega como reintentable. `AccessDenied` se entrega como
/// `unavailable` con un mensaje legible.
pub async fn record_shortcut_on(
    connection: &Connection,
    timeout: Duration,
    in_flight: &AtomicBool,
) -> Result<RecordedShortcut, String> {
    record_shortcut_with(connection, timeout, in_flight, BUSY_RETRY_DELAY).await
}

pub async fn record_shortcut_with(
    connection: &Connection,
    timeout: Duration,
    in_flight: &AtomicBool,
    busy_retry_delay: Duration,
) -> Result<RecordedShortcut, String> {
    if in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(recorded(RecordStatus::Busy, "", ""));
    }
    let _guard = InFlight(in_flight);

    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Err(EXTENSION_INACTIVE_ERROR.to_string());
    }
    let proxy = ExtensionShortcutsProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    let mut result = record_once(connection, &proxy, timeout).await;
    if matches!(&result, Ok(r) if r.status == RecordStatus::Busy.as_str()) {
        tokio::time::sleep(busy_retry_delay).await;
        result = record_once(connection, &proxy, timeout).await;
    }
    result
}

async fn record_once(
    connection: &Connection,
    proxy: &ExtensionShortcutsProxy<'_>,
    timeout: Duration,
) -> Result<RecordedShortcut, String> {
    match tokio::time::timeout(timeout, proxy.record_shortcut()).await {
        Err(_) => Ok(recorded(RecordStatus::Timeout, "", "")),
        Ok(Ok((accel, status))) => Ok(interpret_record_reply(&accel, &status)),
        Ok(Err(e)) if is_access_denied(&e) => Ok(unavailable()),
        Ok(Err(_)) if !name_has_owner(connection, EXTENSION_BUS_NAME).await => {
            Err(EXTENSION_INACTIVE_ERROR.to_string())
        }
        Ok(Err(e)) => Err(call_error(&e, "no se pudo grabar el atajo")),
    }
}

static RECORDING: AtomicBool = AtomicBool::new(false);

pub(super) async fn session() -> Result<Connection, String> {
    Connection::session()
        .await
        .map_err(|_| "no se pudo conectar al bus de sesión".to_string())
}

/// `{ extension_active, shortcuts: { action: accel } }`. Sin extensión activa
/// no es un error: `extension_active: false` y mapa vacío.
#[tauri::command]
pub async fn get_shortcuts() -> Result<ShortcutsInfo, String> {
    get_shortcuts_on(&session().await?).await
}

/// `accel` vacío quita el atajo. Con la extensión inactiva devuelve
/// `EXTENSION_INACTIVE_ERROR` (`"extension_inactive"`) y con una extensión
/// vieja que no conoce el método, `"extension_outdated"`.
#[tauri::command]
pub async fn set_shortcut(action: String, accel: String) -> Result<(), String> {
    set_shortcut_on(&session().await?, &action, &accel).await
}

/// Graba un atajo con el grab modal de la extensión (en el webview no llegan
/// las combinaciones con Super ni las ya ligadas por Mutter). Devuelve
/// `{ accel, status }` con status `ok|cancelled|timeout|busy|invalid`; `accel`
/// solo viene con `ok`. Err `"extension_inactive"` si la extensión no está.
#[tauri::command]
pub async fn record_shortcut() -> Result<RecordedShortcut, String> {
    record_shortcut_on(&session().await?, RECORD_CALL_TIMEOUT, &RECORDING).await
}

/// Atajos de GNOME o del usuario que ya usan `accel` (texto para mostrar).
#[tauri::command]
pub async fn check_shortcut_conflicts(accel: String) -> Result<Vec<String>, String> {
    check_conflicts_on(&session().await?, &accel).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_actions_parse() {
        assert_eq!(ShortcutAction::parse("capture"), Ok(ShortcutAction::Capture));
        assert_eq!(ShortcutAction::Capture.as_str(), "capture");
        for bad in ["", "Capture", "capture ", "emoji", "../capture", "capture\n"] {
            assert!(ShortcutAction::parse(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn valid_accelerators_are_accepted() {
        for ok in [
            "<Super><Shift>c",
            "<Control><Alt>Delete",
            "<Primary>1",
            "<super>space",
            "<Ctrl>F5",
            "<Meta>x",
            "<Hyper>j",
            "<Shift><Alt>c",
            "F35",
            "<Shift>F9",
            "F9",
            "f12",
            "<Shift>F1",
            "<Super>KP_Enter",
        ] {
            assert_eq!(validate_accel(ok), Ok(ok), "{ok:?}");
        }
    }

    #[test]
    fn accelerators_need_a_modifier_unless_they_are_function_keys() {
        for bad in ["c", "Delete", "space", "F0", "F36", "F01", "F", "<Shift>c", "<Shift>space"] {
            assert!(validate_accel(bad).is_err(), "{bad:?}");
        }
        for ok in ["F1", "F24", "F35", "<Shift>F9"] {
            assert!(validate_accel(ok).is_ok(), "{ok:?}");
        }
    }

    #[test]
    fn malformed_accelerators_are_rejected() {
        let long_key = format!("<Super>{}", "a".repeat(MAX_KEY_LEN + 1));
        let too_long = format!("<Super>{}", "a".repeat(MAX_ACCEL_LEN));
        for bad in [
            "",
            "<Super>",
            "<Super",
            "<Super>>c",
            "<Nope>c",
            "<Mod4>Print",
            "<Ctl>c",
            "<>c",
            "<Super><Shift>",
            "<Super>c<Shift>",
            "<Super>c d",
            "<Super>c\n",
            "<Super>\nc",
            "<Super>c\0",
            "<Super>é",
            "<Super>a-b",
            "Super+C",
            &long_key,
            &too_long,
        ] {
            assert!(validate_accel(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn clearing_is_the_only_empty_value_allowed() {
        assert_eq!(validate_accel_or_clear(""), Ok(""));
        assert_eq!(validate_accel_or_clear("  \t"), Ok(""), "solo espacios también quita");
        assert_eq!(validate_accel_or_clear("<Super>c"), Ok("<Super>c"));
        assert!(validate_accel_or_clear("c").is_err());
        assert!(validate_accel("").is_err(), "comprobar conflictos exige atajo");
    }

    #[test]
    fn remote_errors_are_bounded_and_stripped_of_control_characters() {
        assert_eq!(bounded_remote_error("en uso\n\0"), "en uso");
        assert_eq!(bounded_remote_error(""), "la extensión rechazó el atajo");
        assert_eq!(bounded_remote_error(&"x".repeat(1000)).chars().count(), MAX_REMOTE_ERROR_LEN);
    }

    #[test]
    fn unknown_actions_from_the_extension_are_not_exposed() {
        let raw = HashMap::from([
            ("capture".to_string(), "<Super>c".to_string()),
            ("emoji".to_string(), "<Super>e".to_string()),
        ]);
        assert_eq!(
            known_shortcuts(raw),
            HashMap::from([("capture".to_string(), "<Super>c".to_string())])
        );
    }

    #[test]
    fn record_statuses_map_to_stable_strings_and_unknown_is_invalid() {
        for (raw, status) in [
            ("ok", RecordStatus::Ok),
            ("cancelled", RecordStatus::Cancelled),
            ("timeout", RecordStatus::Timeout),
            ("busy", RecordStatus::Busy),
            ("invalid", RecordStatus::Invalid),
            ("unavailable", RecordStatus::Unavailable),
        ] {
            assert_eq!(RecordStatus::parse(raw), status);
            assert_eq!(status.as_str(), raw);
        }
        for odd in ["", "OK", "done", "ok ", "error"] {
            assert_eq!(RecordStatus::parse(odd), RecordStatus::Invalid, "{odd:?}");
        }
    }

    #[test]
    fn only_a_valid_accel_is_delivered_with_ok() {
        assert_eq!(
            interpret_record_reply("<Super>c", "ok"),
            RecordedShortcut { accel: "<Super>c".into(), status: "ok".into(), message: String::new() }
        );
        for bad in ["", "c", "<Super>c\n", "<Nope>c", "<Shift>c"] {
            let got = interpret_record_reply(bad, "ok");
            assert_eq!((got.accel.as_str(), got.status.as_str()), ("", "invalid"), "{bad:?}");
            assert!(!got.message.is_empty(), "{bad:?}: explica por qué");
        }
    }

    #[test]
    fn invalid_carries_the_reason_as_a_bounded_message_and_never_an_accel() {
        let got = interpret_record_reply("Hace falta un modificador.\n", "invalid");
        assert_eq!(got.accel, "");
        assert_eq!(got.status, "invalid");
        assert_eq!(got.message, "Hace falta un modificador.");
        assert_eq!(interpret_record_reply("", "invalid").message, "la extensión rechazó el atajo");
        assert_eq!(
            interpret_record_reply(&"x".repeat(1000), "invalid").message.chars().count(),
            MAX_REMOTE_ERROR_LEN
        );
    }

    #[test]
    fn other_statuses_carry_neither_accel_nor_message() {
        for status in ["cancelled", "timeout", "busy"] {
            let got = interpret_record_reply("<Super>c", status);
            assert_eq!((got.accel.as_str(), got.message.as_str()), ("", ""), "{status}");
            assert_eq!(got.status, status);
        }
    }

    #[test]
    fn unavailable_carries_a_readable_message_but_no_accel() {
        let got = interpret_record_reply("<Super>c", "unavailable");
        assert_eq!((got.status.as_str(), got.accel.as_str()), ("unavailable", ""));
        assert!(got.message.contains(APP_DISPLAY_NAME), "{}", got.message);
    }

    #[test]
    fn unknown_member_error_names_are_the_three_dbus_ones() {
        for name in UNKNOWN_MEMBER_ERROR_NAMES {
            assert!(name.starts_with("org.freedesktop.DBus.Error.Unknown"), "{name}");
        }
        assert!(is_unknown_member(&zbus::Error::InterfaceNotFound));
        assert!(is_unknown_member(&zbus::Error::FDO(Box::new(
            zbus::fdo::Error::UnknownMethod("x".into())
        ))));
        assert!(!is_unknown_member(&zbus::Error::FDO(Box::new(zbus::fdo::Error::Failed("x".into())))));
        assert!(!is_unknown_member(&zbus::Error::InvalidReply));
    }
}
