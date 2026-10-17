//! Comandos del Hub (pestaña de ajustes): estado de la integración con la
//! extensión GNOME, selector de carpeta del portal XDG y arranque automático
//! con la sesión.

use std::path::{Path, PathBuf};

use ashpd::desktop::file_chooser::SelectedFiles;
use ashpd::desktop::ResponseError;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;

use super::output::{resolve_save_dir, resolve_save_dir_with, validate_chosen_save_path};
use crate::capture::uri_to_path;

const EXTENSION_BUS_NAME: &str = "org.knivchit.ClipboardService";
const AUTOSTART_FILE_NAME: &str = "knivchit.desktop";

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct IntegrationStatus {
    pub extension_active: bool,
}

/// `true` si `name` tiene dueño en el bus de `connection`. Cualquier error de
/// D-Bus (bus inalcanzable, nombre inválido) cuenta como «sin dueño»: la
/// consulta es informativa y nunca debe entrar en pánico ni fallar el comando.
pub async fn name_has_owner(connection: &zbus::Connection, name: &str) -> bool {
    async fn query(connection: &zbus::Connection, name: &str) -> zbus::Result<bool> {
        let proxy = zbus::fdo::DBusProxy::new(connection).await?;
        let name = zbus::names::BusName::try_from(name)?;
        Ok(proxy.name_has_owner(name).await?)
    }
    query(connection, name).await.unwrap_or(false)
}

/// Estado de la extensión: activa si publica `org.knivchit.ClipboardService`.
#[tauri::command]
pub async fn get_integration_status() -> IntegrationStatus {
    let extension_active = match zbus::Connection::session().await {
        Ok(connection) => name_has_owner(&connection, EXTENSION_BUS_NAME).await,
        Err(_) => false,
    };
    IntegrationStatus { extension_active }
}

/// Valida la carpeta devuelta por el portal con las mismas reglas que
/// `save_capture` (absoluta, sin `..` ni NUL) y la serializa como texto.
pub fn validate_chosen_dir(path: &Path) -> Result<String, String> {
    validate_chosen_save_path(path)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Selector de carpeta del portal XDG (`FileChooser`, modo carpeta). `None` si
/// el usuario cancela. SIN VERIFICAR contra un portal real: no se puede
/// simular en tests (igual que `save_capture_as`).
#[tauri::command]
pub async fn choose_save_dir() -> Result<Option<String>, String> {
    let request = SelectedFiles::open_file()
        .connection(crate::portal::connection().await)
        .title("Carpeta de capturas")
        .directory(true)
        .modal(true);
    let chosen = match request.send().await.and_then(|r| r.response()) {
        Ok(files) => files
            .uris()
            .first()
            .and_then(|uri| uri_to_path(&uri.to_string()).ok()),
        Err(ashpd::Error::Response(ResponseError::Cancelled)) => None,
        Err(e) => return Err(format!("no se pudo abrir el selector de carpeta: {e}")),
    };
    chosen.map(|dir| validate_chosen_dir(&dir)).transpose()
}

/// Carpeta de autostart: `$XDG_CONFIG_HOME/autostart` si es una ruta absoluta
/// y, si no, `$HOME/.config/autostart`.
pub fn autostart_dir(xdg_config_home: Option<String>, home: Option<String>) -> Result<PathBuf, String> {
    match (xdg_config_home, home) {
        (Some(xdg), _) if Path::new(&xdg).is_absolute() => Ok(PathBuf::from(xdg).join("autostart")),
        (_, Some(home)) if Path::new(&home).is_absolute() => {
            Ok(PathBuf::from(home).join(".config").join("autostart"))
        }
        _ => Err("no se pudo determinar la carpeta de configuración del usuario".to_string()),
    }
}

/// Ejecutable a lanzar: la variable `APPIMAGE` (ruta del AppImage, no la del
/// binario extraído en un montaje temporal) si es absoluta; si no, `current_exe`.
pub fn autostart_exec_path(appimage: Option<String>, current_exe: Option<PathBuf>) -> Result<PathBuf, String> {
    match appimage.filter(|p| Path::new(p).is_absolute()) {
        Some(path) => Ok(PathBuf::from(path)),
        None => current_exe.ok_or_else(|| "no se pudo determinar el ejecutable de Knivchit".to_string()),
    }
}

/// Contenido del `.desktop` de autostart. `exec` se escribe según la
/// especificación de Desktop Entry para `Exec`:
/// - entre comillas dobles (cubre espacios y caracteres reservados);
/// - dentro, `"`, `` ` ``, `$` y `\` llevan un `\` delante (regla de las
///   comillas) y, como la regla general de las cadenas se aplica ANTES, cada
///   `\` de ese escape se duplica: `"` → `\\"` y una `\` literal → cuatro `\`;
/// - `%` es código de campo (`%f`, `%u`…): un `%` literal se escribe `%%`.
/// Rechaza saltos de línea y NUL: inyectarían claves nuevas en el archivo.
pub fn autostart_desktop_content(exec: &Path) -> Result<String, String> {
    let exec = exec.to_string_lossy();
    if exec.contains(['\n', '\r', '\0']) {
        return Err("la ruta del ejecutable contiene caracteres de control".to_string());
    }
    let mut quoted = String::from("\"");
    for c in exec.chars() {
        match c {
            '"' | '`' | '$' => {
                quoted.push_str("\\\\");
                quoted.push(c);
            }
            '\\' => quoted.push_str("\\\\\\\\"),
            '%' => quoted.push_str("%%"),
            _ => quoted.push(c),
        }
    }
    quoted.push('"');
    Ok(format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Knivchit\n\
         Comment=Capturador de pantalla e historial de portapapeles\n\
         Exec={quoted} --hidden\n\
         Terminal=false\n\
         X-GNOME-Autostart-enabled=true\n"
    ))
}

fn autostart_file(dir: &Path) -> PathBuf {
    dir.join(AUTOSTART_FILE_NAME)
}

pub fn get_autostart_in(dir: &Path) -> bool {
    autostart_file(dir).is_file()
}

/// Crea o borra únicamente `<dir>/knivchit.desktop`; nunca escribe fuera de
/// `dir`. Borrar algo que no existe no es un error.
pub fn set_autostart_in(dir: &Path, enabled: bool, exec: &Path) -> Result<(), String> {
    let file = autostart_file(dir);
    if !enabled {
        return match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("no se pudo desactivar el arranque automático: {e}")),
        };
    }
    let content = autostart_desktop_content(exec)?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("no se pudo crear la carpeta de autostart: {e}"))?;
    std::fs::write(&file, content)
        .map_err(|e| format!("no se pudo activar el arranque automático: {e}"))
}

/// Resuelve la carpeta de capturas configurada (mismas reglas que
/// `save_capture`: absoluta, sin `..` ni NUL; el placeholder da la carpeta de
/// Imágenes) y la crea si no existe, para que abrirla nunca falle por eso.
pub fn prepare_dir_to_open(
    raw: &str,
    default_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    let dir = resolve_save_dir_with(raw, default_dir)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("no se pudo crear la carpeta de capturas ({:?})", e.kind()))?;
    Ok(dir)
}

/// Abre en el gestor de archivos la carpeta de capturas CONFIGURADA. Es un
/// comando propio, y no el permiso `opener:allow-open-path`, porque el scope de
/// una capability es estático y la carpeta la elige el usuario en ejecución:
/// cubrirla exigiría un comodín amplio. Aquí el frontend no manda ninguna
/// ruta; solo se abre un directorio ya validado.
#[tauri::command]
pub async fn open_save_dir(pool: State<'_, SqlitePool>) -> Result<(), String> {
    let settings = crate::db::get_settings(&pool).await.map_err(|e| e.to_string())?;
    let dir = prepare_dir_to_open(&settings.screenshot_save_dir, || {
        resolve_save_dir(super::output::SAVE_DIR_PLACEHOLDER)
    })?;
    // Mensaje fijo: ni la ruta ni el detalle del error salen del comando.
    open_in_file_manager(&dir).map_err(|_| "no se pudo abrir la carpeta de capturas".to_string())
}

/// Cambios al entorno para lanzar un programa DEL SISTEMA desde dentro de un AppImage.
///
/// El hook del AppImage antepone su montaje (`APPDIR`, p. ej. `/tmp/.mount_xxxx`) a `PATH`,
/// `LD_LIBRARY_PATH`, `XDG_DATA_DIRS`, `GIO_MODULE_DIR`, `PYTHONHOME`… y un hijo que las hereda
/// usa las librerías de Ubuntu 22.04 empaquetadas: `gio` falla, `xdg-open` cae a sus métodos
/// genéricos y termina abriendo la carpeta en el navegador (`$BROWSER`). Devuelve, por variable,
/// el valor sin las rutas del montaje (`Some`) o `None` si no queda nada y hay que quitarla.
/// Solo cuentan componentes completos del montaje (`/tmp/.mount_x` no es `/tmp/.mount_xy`).
/// Con `appdir` vacío (fuera de un AppImage) no cambia nada.
pub fn host_env_changes(
    appdir: &str,
    vars: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, Option<String>)> {
    if appdir.is_empty() {
        return Vec::new();
    }
    let inside = |entry: &str| {
        entry == appdir
            || entry.strip_prefix(appdir).is_some_and(|rest| rest.starts_with('/'))
    };
    vars.into_iter()
        .filter_map(|(key, value)| {
            if !value.split(':').any(inside) {
                return None;
            }
            let kept: Vec<&str> = value.split(':').filter(|e| !e.is_empty() && !inside(e)).collect();
            Some((key, (!kept.is_empty()).then(|| kept.join(":"))))
        })
        .collect()
}

/// Abre `dir` con el programa por defecto del sistema (`xdg-open`) con el entorno del sistema, no
/// el del AppImage (ver `host_env_changes`). No espera a que termine, pero recoge al hijo.
fn open_in_file_manager(dir: &Path) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(dir);
    if let Some(appdir) = std::env::var("APPDIR").ok().filter(|v| !v.is_empty()) {
        for (key, value) in host_env_changes(&appdir, std::env::vars()) {
            match value {
                Some(value) => cmd.env(key, value),
                None => cmd.env_remove(key),
            };
        }
    }
    let mut child = cmd.spawn()?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn system_autostart_dir() -> Result<PathBuf, String> {
    autostart_dir(std::env::var("XDG_CONFIG_HOME").ok(), std::env::var("HOME").ok())
}

#[tauri::command]
pub fn get_autostart() -> bool {
    system_autostart_dir().is_ok_and(|dir| get_autostart_in(&dir))
}

#[tauri::command]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    let dir = system_autostart_dir()?;
    let exec = autostart_exec_path(std::env::var("APPIMAGE").ok(), std::env::current_exe().ok())?;
    set_autostart_in(&dir, enabled, &exec)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("knivchit-hub-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn desktop_content_launches_hidden_and_enables_gnome_autostart() {
        let c = autostart_desktop_content(Path::new("/opt/Knivchit.AppImage")).unwrap();
        assert!(c.starts_with("[Desktop Entry]\n"));
        assert!(c.contains("Exec=\"/opt/Knivchit.AppImage\" --hidden\n"));
        assert!(c.contains("X-GNOME-Autostart-enabled=true\n"));
        assert!(c.contains("Type=Application\n"));
    }

    #[test]
    fn desktop_content_quotes_spaces_and_escapes_per_the_desktop_entry_spec() {
        let line = |path: &str| {
            let c = autostart_desktop_content(Path::new(path)).unwrap();
            c.lines().find(|l| l.starts_with("Exec=")).unwrap().to_string()
        };
        assert_eq!(line("/home/u/Mis apps/V"), r#"Exec="/home/u/Mis apps/V" --hidden"#);
        assert_eq!(line("/home/u/100%/V"), r#"Exec="/home/u/100%%/V" --hidden"#);
        assert_eq!(line("/h/a\"b/V"), r#"Exec="/h/a\\"b/V" --hidden"#);
        assert_eq!(line("/h/a$b/V"), r#"Exec="/h/a\\$b/V" --hidden"#);
        assert_eq!(line("/h/a`b/V"), r#"Exec="/h/a\\`b/V" --hidden"#);
        assert_eq!(line("/h/a\\b/V"), r#"Exec="/h/a\\\\b/V" --hidden"#);
        assert_eq!(line("/h/%f %u/V"), r#"Exec="/h/%%f %%u/V" --hidden"#);
    }

    #[test]
    fn desktop_content_rejects_control_characters() {
        for bad in ["/a\nExec=/bin/evil", "/a\rb", "/a\0b"] {
            assert!(autostart_desktop_content(Path::new(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn exec_path_prefers_an_absolute_appimage_variable() {
        let exe = Some(PathBuf::from("/tmp/.mount_x/usr/bin/knivchit"));
        assert_eq!(
            autostart_exec_path(Some("/home/u/Knivchit.AppImage".into()), exe.clone()),
            Ok(PathBuf::from("/home/u/Knivchit.AppImage"))
        );
        for bad in [None, Some(String::new()), Some("relativa.AppImage".to_string())] {
            assert_eq!(autostart_exec_path(bad, exe.clone()), Ok(exe.clone().unwrap()));
        }
        assert!(autostart_exec_path(None, None).is_err());
    }

    #[test]
    fn autostart_dir_prefers_absolute_xdg_then_home() {
        assert_eq!(
            autostart_dir(Some("/cfg".into()), Some("/home/u".into())),
            Ok(PathBuf::from("/cfg/autostart"))
        );
        assert_eq!(
            autostart_dir(None, Some("/home/u".into())),
            Ok(PathBuf::from("/home/u/.config/autostart"))
        );
        assert_eq!(
            autostart_dir(Some("relativa".into()), Some("/home/u".into())),
            Ok(PathBuf::from("/home/u/.config/autostart"))
        );
        assert!(autostart_dir(None, None).is_err());
        assert!(autostart_dir(Some("rel".into()), Some("rel".into())).is_err());
    }

    #[test]
    fn set_autostart_creates_then_removes_only_its_own_file() {
        let base = tmp();
        let dir = base.join("autostart");
        let other = dir.join("otra-app.desktop");
        let exec = Path::new("/opt/Knivchit.AppImage");

        assert!(!get_autostart_in(&dir));
        set_autostart_in(&dir, true, exec).unwrap();
        assert!(get_autostart_in(&dir));
        std::fs::write(&other, "x").unwrap();

        set_autostart_in(&dir, false, exec).unwrap();
        assert!(!get_autostart_in(&dir));
        assert!(other.exists(), "no toca archivos ajenos");
        set_autostart_in(&dir, false, exec).unwrap();
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn disabling_does_not_create_the_directory() {
        let dir = tmp().join("autostart");
        set_autostart_in(&dir, false, Path::new("/x")).unwrap();
        assert!(!dir.exists());
    }

    #[test]
    fn enabling_with_a_bad_exec_writes_nothing() {
        let base = tmp();
        let dir = base.join("autostart");
        assert!(set_autostart_in(&dir, true, Path::new("/a\nb")).is_err());
        assert!(!base.exists());
    }

    #[test]
    fn chosen_dir_goes_through_the_same_validation_as_saving() {
        assert_eq!(validate_chosen_dir(Path::new("/home/u/Capturas")), Ok("/home/u/Capturas".to_string()));
        for bad in ["rel/ativa", "/home/u/../etc", "/a\0b"] {
            assert!(validate_chosen_dir(Path::new(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn prepare_dir_to_open_creates_the_configured_dir_and_rejects_unsafe_ones() {
        let base = tmp();
        let dir = base.join("Capturas");
        let ok = prepare_dir_to_open(dir.to_str().unwrap(), || Err("no".into())).unwrap();
        assert_eq!(ok, dir);
        assert!(dir.is_dir());

        let unsafe_base = tmp();
        for bad in [
            "".to_string(),
            "relativa".to_string(),
            format!("{}/../x", unsafe_base.display()),
        ] {
            assert!(prepare_dir_to_open(&bad, || Err("no".into())).is_err(), "{bad:?}");
        }
        assert!(!unsafe_base.exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn prepare_dir_to_open_uses_the_default_only_for_the_placeholder() {
        let base = tmp();
        let target = base.join("Pictures/Knivchit");
        let got = prepare_dir_to_open(super::super::output::SAVE_DIR_PLACEHOLDER, || Ok(target.clone())).unwrap();
        assert_eq!(got, target);
        assert!(target.is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    fn env(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn host_env_changes_strips_the_appimage_mount_from_search_paths() {
        let vars = env(&[
            ("PATH", "/tmp/.mount_x/usr/bin/:/tmp/.mount_x/bin/:/usr/local/bin:/usr/bin"),
            ("XDG_DATA_DIRS", "/tmp/.mount_x/usr/share/:/usr/share"),
            ("HOME", "/home/u"),
        ]);
        let mut got = host_env_changes("/tmp/.mount_x", vars);
        got.sort();
        assert_eq!(
            got,
            vec![
                ("PATH".to_string(), Some("/usr/local/bin:/usr/bin".to_string())),
                ("XDG_DATA_DIRS".to_string(), Some("/usr/share".to_string())),
            ]
        );
    }

    #[test]
    fn host_env_changes_removes_variables_that_only_point_into_the_mount() {
        let vars = env(&[
            ("APPDIR", "/tmp/.mount_x"),
            ("GIO_MODULE_DIR", "/tmp/.mount_x/usr/lib/gio/modules"),
            ("PYTHONHOME", "/tmp/.mount_x/usr/"),
        ]);
        let mut got = host_env_changes("/tmp/.mount_x", vars);
        got.sort();
        assert_eq!(
            got,
            vec![
                ("APPDIR".to_string(), None),
                ("GIO_MODULE_DIR".to_string(), None),
                ("PYTHONHOME".to_string(), None),
            ]
        );
    }

    #[test]
    fn host_env_changes_only_matches_whole_path_components_of_the_mount() {
        // Otro montaje con el mismo prefijo y una ruta del usuario que solo contiene el texto.
        let vars = env(&[("PATH", "/tmp/.mount_xy/bin:/home/u/tmp/.mount_x/bin:/usr/bin")]);
        assert!(host_env_changes("/tmp/.mount_x", vars).is_empty());
    }

    #[test]
    fn host_env_changes_does_nothing_outside_an_appimage() {
        let vars = env(&[("PATH", "/usr/bin:/bin"), ("APPDIR", "/tmp/.mount_x")]);
        assert!(host_env_changes("", vars).is_empty());
    }
}
