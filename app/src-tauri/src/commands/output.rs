//! Salida de la captura ya compuesta por el frontend: guardar, copiar y
//! fijar (pin). El backend solo valida y entrega el PNG — no lo recompone.
//! Nada del contenido de la imagen se escribe en logs.

use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use ashpd::desktop::file_chooser::SelectedFiles;
use ashpd::desktop::notification::{Notification, NotificationProxy};
use ashpd::desktop::ResponseError;
use sqlx::SqlitePool;
use tauri::http::HeaderMap;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Runtime, State};

use super::capture_flow::{expand_tilde, finish_capture_ui, CaptureState};
use crate::monitors::CaptureOutcome;
use crate::capture::{percent_decode, uri_to_path};

pub const MAX_PNG_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_DIMENSION: u32 = 16384;
/// Tope de megapíxeles totales: el límite por lado solo permitiría 16384² ≈
/// 1 GiB de RGBA al decodificar (`copy_capture`). 100 MP cubre 8K (33 MP) de sobra.
pub const MAX_PIXELS: u64 = 100_000_000;

/// Valor que la migración inicial deja en `Settings.screenshot_save_dir`
/// (db/migrations.rs; no se puede editar una migración aplicada) hasta que
/// el onboarding lo reemplaza. El frontend lo repite en Onboarding.tsx.
pub const SAVE_DIR_PLACEHOLDER: &str = "__PLACEHOLDER__";

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// Chunk IEND completo (longitud 0 + tipo + CRC fijo): todo PNG íntegro termina así.
const PNG_IEND: [u8; 12] = [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82];

/// Valida firma, tamaño, dimensiones (cabecera IHDR) y el chunk IEND final
/// — sin decodificar la imagen; el IEND descarta PNG truncados. Devuelve `(ancho, alto)`.
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32), String> {
    if bytes.len() > MAX_PNG_BYTES {
        return Err("la imagen supera el máximo de 64 MiB".to_string());
    }
    // firma (8) + longitud del chunk (4) + "IHDR" (4) + ancho (4) + alto (4)
    if bytes.len() < 24 + PNG_IEND.len()
        || bytes[..8] != PNG_SIGNATURE
        || &bytes[12..16] != b"IHDR"
    {
        return Err("el cuerpo no es un PNG válido".to_string());
    }
    if bytes[bytes.len() - PNG_IEND.len()..] != PNG_IEND {
        return Err("el PNG está truncado (falta el chunk IEND)".to_string());
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        return Err("el PNG tiene dimensiones cero".to_string());
    }
    if width > MAX_DIMENSION || height > MAX_DIMENSION {
        return Err(format!(
            "el PNG supera el máximo de {MAX_DIMENSION} px por lado"
        ));
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(format!(
            "el PNG supera el máximo de {} megapíxeles",
            MAX_PIXELS / 1_000_000
        ));
    }
    Ok((width, height))
}

/// Cuerpo raw de la petición; cualquier otra forma de cuerpo se rechaza.
pub fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        InvokeBody::Json(_) => Err("se esperaba el PNG como cuerpo raw".to_string()),
    }
}

pub fn header_str<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, String> {
    headers
        .get(name)
        .ok_or_else(|| format!("falta el header {name}"))?
        .to_str()
        .map_err(|_| format!("el header {name} no es texto válido"))
}

/// Estampa de hora local `YYYYMMDD-HHMMSS`. Vive detrás de una función
/// para que los tests inyecten la suya y no dependan del reloj.
pub fn local_stamp() -> String {
    gtk::glib::DateTime::now_local()
        .ok()
        .and_then(|dt| dt.format("%Y%m%d-%H%M%S").ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "00000000-000000".to_string())
}

/// Escribe `bytes` en `dir` como `knivchit-<stamp>.png`; si el nombre ya
/// existe, sufija `-N`. `create_new` hace atómica la reserva del nombre.
pub fn save_png(bytes: &[u8], dir: &Path, stamp: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("no se pudo crear la carpeta de guardado: {e}"))?;
    for n in 0u32..10_000 {
        let name = if n == 0 {
            format!("knivchit-{stamp}.png")
        } else {
            format!("knivchit-{stamp}-{n}.png")
        };
        let path = dir.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|e| format!("no se pudo guardar la captura: {e}"))?;
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("no se pudo guardar la captura: {e}")),
        }
    }
    Err("no se encontró un nombre libre para la captura".to_string())
}

/// Consume la captura pendiente una sola vez. Si `action` falla, la
/// captura vuelve a quedar pendiente para que el usuario pueda reintentar
/// sin repetir la captura.
pub fn with_pending<T>(
    pending: &Mutex<Option<PathBuf>>,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let path = pending
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or_else(|| "no hay una captura pendiente".to_string())?;
    let result = action();
    if result.is_err() {
        *pending.lock().map_err(|e| e.to_string())? = Some(path);
    } else {
        crate::capture::discard_if_temp_crop(&path);
    }
    result
}

/// Nombre de carpeta usable como un único componente de ruta. Si el candidato (p. ej. una
/// traducción) está vacío, es `.`/`..`, o lleva `/`, `%` (la ruta guardada se decodifica como URL),
/// NUL o saltos de línea, se devuelve el nombre sin traducir, `Screenshots`.
pub fn safe_folder_name(candidate: &str) -> String {
    let name = candidate.trim();
    let bad = name.is_empty()
        || name == "."
        || name == ".."
        || name.chars().any(|c| matches!(c, '/' | '%' | '\0' | '\n' | '\r'));
    if bad { "Screenshots".to_string() } else { name.to_string() }
}

/// Nombre de la carpeta de capturas: el MISMO que usa GNOME, traducido al idioma del usuario
/// («Capturas de pantalla», «Captures d’écran», «Bildschirmfotos»…). Sale del dominio de
/// traducción `gnome-shell`; sin traducción queda `Screenshots`.
pub fn screenshots_folder_name() -> String {
    safe_folder_name(gtk::glib::dgettext(Some("gnome-shell"), "Screenshots").as_str())
}

/// Carpeta por defecto mientras la configuración sigue en el placeholder:
/// «Imágenes» del usuario según XDG (o `$HOME/Pictures`) + `folder` (el nombre de la carpeta de
/// capturas de GNOME en su idioma, ver `screenshots_folder_name`).
pub fn default_save_dir(
    pictures: Option<PathBuf>,
    home: Option<String>,
    folder: &str,
) -> Result<PathBuf, String> {
    let base = match (pictures, home) {
        (Some(p), _) if p.is_absolute() => p,
        (_, Some(h)) if !h.is_empty() => PathBuf::from(h).join("Pictures"),
        _ => return Err("no se pudo determinar la carpeta de imágenes del usuario".to_string()),
    };
    Ok(base.join(safe_folder_name(folder)))
}

fn system_default_save_dir() -> Result<PathBuf, String> {
    default_save_dir(
        gtk::glib::user_special_dir(gtk::glib::UserDirectory::Pictures),
        std::env::var("HOME").ok(),
        &screenshots_folder_name(),
    )
}

/// `path` con `~` en lugar de `home` si está DENTRO de `home` (por componentes: `/home/uu` no
/// está en `/home/u`); fuera de `home` se deja absoluta.
pub fn tilde_form(path: &Path, home: &str) -> String {
    match path.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

/// La carpeta por defecto del sistema, lista para mostrarla y guardarla (con `~`).
pub fn default_save_dir_display() -> Result<String, String> {
    let dir = system_default_save_dir()?;
    let home = std::env::var("HOME").unwrap_or_default();
    Ok(if home.is_empty() { dir.display().to_string() } else { tilde_form(&dir, &home) })
}

/// Carpetas de `$HOME` donde guardar un PNG pondría un archivo a disposición
/// de algo que lo ejecuta o lee con privilegios del usuario (claves, arranque
/// automático, servicios, extensiones del Shell).
const SENSITIVE_HOME_DIRS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".config/autostart",
    ".config/systemd",
    ".config/environment.d",
    ".local/bin",
    ".local/share/applications",
    ".local/share/gnome-shell",
    ".local/share/dbus-1",
];

/// `true` si `dir` es una de las carpetas sensibles de `home` o está dentro.
pub fn is_sensitive_dir(dir: &Path, home: &Path) -> bool {
    SENSITIVE_HOME_DIRS
        .iter()
        .any(|sub| dir.starts_with(home.join(sub)))
}

/// Decodifica el percent-encoding, expande `~` y exige una ruta absoluta
/// sin NUL ni segmentos `..`. Se valida DESPUÉS de decodificar: `%20%20`
/// o `%2e%2e` no deben colarse como espacios o `..` ya resueltos. Solo el
/// placeholder exacto se sustituye por la carpeta por defecto.
pub fn resolve_save_dir(raw: &str) -> Result<PathBuf, String> {
    resolve_save_dir_with(raw, system_default_save_dir)
}

pub fn resolve_save_dir_with(
    raw: &str,
    default_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    let decoded = percent_decode(raw);
    if decoded == SAVE_DIR_PLACEHOLDER {
        return default_dir();
    }
    if decoded.trim().is_empty() {
        return Err("la carpeta de guardado no puede estar vacía".to_string());
    }
    if decoded.contains('\0') {
        return Err("la carpeta de guardado contiene un byte nulo".to_string());
    }
    let dir = expand_tilde(&decoded);
    if !dir.is_absolute() {
        return Err("la carpeta de guardado debe ser una ruta absoluta".to_string());
    }
    if dir.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("la carpeta de guardado no puede contener '..'".to_string());
    }
    if let Some(home) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        if is_sensitive_dir(&dir, Path::new(&home)) {
            return Err("esa carpeta no es un destino seguro para capturas".to_string());
        }
    }
    Ok(dir)
}

fn save_capture_impl(
    pending: &Mutex<Option<PathBuf>>,
    bytes: &[u8],
    save_dir: &str,
    stamp: &str,
) -> Result<String, String> {
    validate_png(bytes)?;
    let dir = resolve_save_dir(save_dir)?;
    with_pending(pending, || save_png(bytes, &dir, stamp))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Guarda en la carpeta CONFIGURADA (`Settings.screenshot_save_dir`), nunca en
/// una que mande el webview: así un webview comprometido no puede escribir en
/// una ruta arbitraria. El frontend ya no manda el header `x-save-dir`; si
/// llegara, se ignora.
#[tauri::command]
pub async fn save_capture<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
    state: State<'_, CaptureState>,
    pool: State<'_, SqlitePool>,
) -> Result<String, String> {
    let bytes = raw_body(&request)?.to_vec();
    let settings = crate::db::get_settings(&pool).await.map_err(|e| e.to_string())?;
    let saved = save_capture_impl(&state.0, &bytes, &settings.screenshot_save_dir, &local_stamp())?;
    finish_capture_ui(&app, CaptureOutcome::Saved);
    spawn_saved_notification(saved.clone());
    Ok(saved)
}

/// Nombre por defecto que ve el usuario en el diálogo «Guardar como» — mismo
/// esquema que `save_png` para las capturas guardadas sin diálogo.
pub fn default_save_as_name(stamp: &str) -> String {
    format!("knivchit-{stamp}.png")
}

/// Mismas reglas que `resolve_save_dir` pero sobre una ruta de ARCHIVO ya
/// elegida por el usuario en el portal nativo: absoluta, sin NUL ni `..`. El
/// portal normalmente ya entrega algo sensato, pero es una ruta externa como
/// cualquier otra — se valida igual antes de escribirle encima.
pub fn validate_chosen_save_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("la ruta elegida debe ser absoluta".to_string());
    }
    if path.components().any(|c| c == std::path::Component::ParentDir) {
        return Err("la ruta elegida no puede contener '..'".to_string());
    }
    if path.as_os_str().as_encoded_bytes().contains(&0) {
        return Err("la ruta elegida contiene un byte nulo".to_string());
    }
    Ok(())
}

/// Abre el diálogo «Guardar como» nativo (`org.freedesktop.portal.FileChooser`,
/// vía ashpd) con `default_name` ya cargado en `default_dir`. `None` significa
/// que el usuario canceló — no es un error. SIN VERIFICAR contra un portal
/// real: no hay forma de simularlo en los tests (igual que `capture_full_screen`
/// en `capture.rs`), se confirma a mano en un GNOME real.
async fn pick_save_as_path(default_dir: &Path, default_name: &str) -> Result<Option<PathBuf>, String> {
    let request = SelectedFiles::save_file()
        .connection(crate::portal::connection().await)
        .title("Guardar captura como")
        .current_name(default_name)
        .current_folder::<PathBuf>(Some(default_dir.to_path_buf()))
        .map_err(|e| format!("no se pudo preparar el diálogo de guardado: {e}"))?;

    match request.send().await.and_then(|r| r.response()) {
        Ok(files) => Ok(files
            .uris()
            .first()
            .and_then(|uri| uri_to_path(&uri.to_string()).ok())),
        Err(ashpd::Error::Response(ResponseError::Cancelled)) => Ok(None),
        Err(e) => Err(format!("no se pudo abrir el diálogo de guardado: {e}")),
    }
}

/// Igual que `save_capture` pero dejando elegir dónde al usuario: sin
/// `x-save-dir`, abre el diálogo nativo con la carpeta configurada (o la de
/// imágenes) como punto de partida. Si cancela, la captura sigue pendiente
/// para reintentar sin recapturar.
#[tauri::command]
pub async fn save_capture_as<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
    state: State<'_, CaptureState>,
    pool: State<'_, SqlitePool>,
) -> Result<Option<String>, String> {
    let bytes = raw_body(&request)?.to_vec();
    validate_png(&bytes)?;

    let settings = crate::db::get_settings(&pool).await.map_err(|e| e.to_string())?;
    let default_dir = resolve_save_dir(&settings.screenshot_save_dir)?;
    let default_name = default_save_as_name(&local_stamp());

    let Some(chosen) = pick_save_as_path(&default_dir, &default_name).await? else {
        return Ok(None);
    };
    validate_chosen_save_path(&chosen)?;

    with_pending(&state.0, || {
        if let Some(parent) = chosen.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("no se pudo crear la carpeta de guardado: {e}"))?;
        }
        write_private(&chosen, &bytes).map_err(|e| format!("no se pudo guardar la captura: {e}"))
    })?;

    let saved = chosen.to_string_lossy().into_owned();
    finish_capture_ui(&app, CaptureOutcome::Saved);
    spawn_saved_notification(saved.clone());
    Ok(Some(saved))
}

/// Escribe `bytes` en `path` (lo crea con modo 0600; si ya existía y el
/// usuario confirmó sobrescribirlo en el diálogo, conserva su modo).
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)
}

/// Notificación de escritorio tras un guardado correcto — portal
/// `org.freedesktop.portal.Notification`, vía ashpd. Nunca incluye contenido
/// de la captura, solo la ruta. Se dispara en una tarea aparte: un fallo acá
/// (p. ej. sin daemon de notificaciones) no debe hacer fallar el guardado,
/// que ya terminó bien.
pub async fn notify_saved(path: &str) -> Result<(), String> {
    let proxy = match crate::portal::connection().await {
        Some(connection) => NotificationProxy::with_connection(connection).await,
        None => NotificationProxy::new().await,
    }
    .map_err(|e| format!("no se pudo conectar al portal de notificaciones: {e}"))?;
    proxy
        .add_notification(
            "org.knivchit.app.capture-saved",
            Notification::new("Captura guardada").body(path),
        )
        .await
        .map_err(|e| format!("no se pudo mostrar la notificación: {e}"))
}

fn spawn_saved_notification(path: String) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = notify_saved(&path).await {
            eprintln!("knivchit: {e}");
        }
    });
}

/// `pub` para que los tests de integración lo ejerzan con un closure de copia inyectable.
pub fn copy_capture_impl(
    pending: &Mutex<Option<PathBuf>>,
    bytes: &[u8],
    copy: impl FnOnce(&[u8]) -> Result<(), String>,
) -> Result<(), String> {
    validate_png(bytes)?;
    with_pending(pending, || copy(bytes))
}

/// Pone el PNG en el portapapeles de la sesión. `gtk::Clipboard` solo se
/// toca desde el hilo principal de GTK: se despacha con `run_on_main_thread`
/// y el resultado vuelve por un canal.
#[tauri::command]
pub fn copy_capture<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
    state: State<'_, CaptureState>,
) -> Result<(), String> {
    let bytes = raw_body(&request)?;
    let copied = copy_capture_impl(&state.0, bytes, |png| {
        let png = png.to_vec();
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(set_clipboard_image(&png));
        })
        .map_err(|e| format!("no se pudo acceder al hilo principal: {e}"))?;
        rx.recv()
            .map_err(|_| "el hilo principal no respondió".to_string())?
    });
    if copied.is_ok() {
        finish_capture_ui(&app, CaptureOutcome::Copied);
    }
    copied
}

fn set_clipboard_image(png: &[u8]) -> Result<(), String> {
    use gtk::gdk_pixbuf::PixbufLoader;
    use gtk::prelude::*;

    if !gtk::is_initialized_main_thread() {
        return Err("GTK no está inicializado (¿sin display?)".to_string());
    }
    let loader = PixbufLoader::with_type("png")
        .map_err(|e| format!("no se pudo preparar el decodificador PNG: {e}"))?;
    loader
        .write(png)
        .map_err(|e| format!("no se pudo decodificar el PNG: {e}"))?;
    loader
        .close()
        .map_err(|e| format!("no se pudo decodificar el PNG: {e}"))?;
    let pixbuf = loader
        .pixbuf()
        .ok_or_else(|| "el PNG no produjo una imagen".to_string())?;
    let display = gtk::gdk::Display::default().ok_or_else(|| "no hay display".to_string())?;
    let clipboard = gtk::Clipboard::default(&display)
        .ok_or_else(|| "no hay portapapeles disponible".to_string())?;
    clipboard.set_image(&pixbuf);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PNG real y mínimo de `w × h` generado con el crate `image`.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([9, 9, 9, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    /// Cabecera PNG falsa con dimensiones arbitrarias (sin pixels).
    fn fake_header(w: u32, h: u32) -> Vec<u8> {
        let mut v = PNG_SIGNATURE.to_vec();
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&PNG_IEND);
        v
    }

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("knivchit-out-{}", uuid::Uuid::new_v4()))
    }

    fn pending() -> Mutex<Option<PathBuf>> {
        Mutex::new(Some(PathBuf::from("/tmp/pending.png")))
    }

    #[test]
    fn validate_png_accepts_a_real_png_and_reports_dimensions() {
        assert_eq!(validate_png(&png(30, 20)), Ok((30, 20)));
    }

    #[test]
    fn validate_png_rejects_non_png_and_truncated() {
        assert!(validate_png(b"GIF89a-no-soy-png-de-ninguna-manera").is_err());
        assert!(validate_png(&PNG_SIGNATURE).is_err());
        assert!(validate_png(&[]).is_err());
    }

    #[test]
    fn validate_png_rejects_truncated_png_with_valid_header() {
        let full = png(16, 16);
        assert!(validate_png(&full[..full.len() - 1]).is_err());
        assert!(validate_png(&full[..full.len() / 2]).is_err());
        assert!(validate_png(&full[..33]).is_err());
    }

    #[test]
    fn validate_png_rejects_oversized_bytes() {
        let mut big = png(2, 2);
        big.resize(MAX_PNG_BYTES + 1, 0);
        assert!(validate_png(&big).is_err());
    }

    #[test]
    fn validate_png_rejects_excess_or_zero_dimensions() {
        assert!(validate_png(&fake_header(MAX_DIMENSION + 1, 10)).is_err());
        assert!(validate_png(&fake_header(10, MAX_DIMENSION + 1)).is_err());
        assert!(validate_png(&fake_header(0, 10)).is_err());
        assert!(validate_png(&fake_header(MAX_DIMENSION, 1)).is_ok());
        // el máximo por lado solo no basta: además hay tope de megapíxeles
        assert!(validate_png(&fake_header(MAX_DIMENSION, MAX_DIMENSION)).is_err());
    }

    #[test]
    fn sensitive_home_dirs_are_recognized_including_subdirs() {
        let home = Path::new("/home/u");
        for bad in [
            "/home/u/.ssh",
            "/home/u/.ssh/sub",
            "/home/u/.config/autostart",
            "/home/u/.local/share/gnome-shell/extensions",
            "/home/u/.local/bin",
        ] {
            assert!(is_sensitive_dir(Path::new(bad), home), "{bad}");
        }
        for ok in [
            "/home/u/Pictures/Knivchit",
            "/home/u/.config/otra",
            "/home/u/.sshfake",
            "/home/otro/.ssh",
            "/tmp/.ssh",
        ] {
            assert!(!is_sensitive_dir(Path::new(ok), home), "{ok}");
        }
    }

    #[test]
    fn resolve_save_dir_rejects_sensitive_home_dirs() {
        assert!(resolve_save_dir("~/.ssh/capturas").is_err());
        assert!(resolve_save_dir("~/.config/autostart").is_err());
        assert!(resolve_save_dir("~/Pictures/Knivchit").is_ok());
    }

    #[test]
    fn save_png_names_by_stamp_and_suffixes_on_collision() {
        let dir = tmp().join("nueva/sub");
        let a = save_png(b"x", &dir, "20261013-101500").unwrap();
        let b = save_png(b"y", &dir, "20261013-101500").unwrap();
        let c = save_png(b"z", &dir, "20261013-101500").unwrap();
        assert_eq!(a.file_name().unwrap(), "knivchit-20261013-101500.png");
        assert_eq!(b.file_name().unwrap(), "knivchit-20261013-101500-1.png");
        assert_eq!(c.file_name().unwrap(), "knivchit-20261013-101500-2.png");
        assert_eq!(std::fs::read(&a).unwrap(), b"x");
        let _ = std::fs::remove_dir_all(dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn save_capture_writes_file_and_consumes_pending_once() {
        let dir = tmp();
        let p = pending();
        let bytes = png(8, 8);
        let saved = save_capture_impl(&p, &bytes, dir.to_str().unwrap(), "s").unwrap();
        assert_eq!(std::fs::read(&saved).unwrap(), bytes);
        assert!(p.lock().unwrap().is_none());
        assert!(save_capture_impl(&p, &bytes, dir.to_str().unwrap(), "s").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_capture_invalid_input_leaves_pending_and_writes_nothing() {
        let dir = tmp();
        let p = pending();
        assert!(save_capture_impl(&p, b"no-png", dir.to_str().unwrap(), "s").is_err());
        assert!(save_capture_impl(&p, &png(2, 2), "  ", "s").is_err());
        assert!(p.lock().unwrap().is_some());
        assert!(!dir.exists());
    }

    #[test]
    fn save_capture_failed_write_restores_pending() {
        let dir = tmp();
        std::fs::write(&dir, b"soy un archivo").unwrap();
        let p = pending();
        let r = save_capture_impl(&p, &png(2, 2), dir.join("sub").to_str().unwrap(), "s");
        assert!(r.is_err());
        assert!(p.lock().unwrap().is_some());
        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn save_capture_rejects_blank_relative_nul_and_parent_dirs_without_creating_anything() {
        let cwd_probe = std::env::current_dir().unwrap();
        let before = std::fs::read_dir(&cwd_probe).unwrap().count();
        let base = tmp();
        let bad = [
            String::new(),
            "   ".to_string(),
            "%20%20%20".to_string(),
            "relativa/carpeta".to_string(),
            "./x".to_string(),
            "%2Frel%00".to_string(),
            "/tmp/a\0b".to_string(),
            format!("{}/../escape", base.display()),
            format!("{}/%2e%2e/escape", base.display()),
            "~/../../etc".to_string(),
        ];
        for dir in &bad {
            let p = pending();
            let r = save_capture_impl(&p, &png(2, 2), dir, "s");
            assert!(r.is_err(), "debía rechazar {dir:?}");
            assert!(p.lock().unwrap().is_some(), "no debe consumir la captura: {dir:?}");
        }
        assert!(!base.exists());
        assert!(!cwd_probe.join("   ").exists());
        assert!(!cwd_probe.join("relativa").exists());
        assert_eq!(std::fs::read_dir(&cwd_probe).unwrap().count(), before);
    }

    #[test]
    fn placeholder_resolves_to_the_default_dir_and_creates_it_only_on_save() {
        let base = tmp();
        let target = base.join("Pictures/Knivchit");
        let resolved = resolve_save_dir_with(SAVE_DIR_PLACEHOLDER, || Ok(target.clone())).unwrap();
        assert_eq!(resolved, target);
        assert!(!base.exists(), "resolver no debe crear nada");
        let saved = save_png(&png(2, 2), &resolved, "s").unwrap();
        assert!(saved.starts_with(&target) && saved.exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn only_the_exact_placeholder_is_substituted() {
        let boom = || -> Result<PathBuf, String> { Err("no debía llamarse".into()) };
        for bad in ["", "  ", "__PLACEHOLDER__/x", "__placeholder__", "rel", "/a/../b"] {
            let r = resolve_save_dir_with(bad, boom);
            assert!(r.is_err(), "{bad:?}");
            assert_ne!(r.unwrap_err(), "no debía llamarse", "{bad:?}");
        }
        // también cuando llega URL-encoded
        let r = resolve_save_dir_with("%5F%5FPLACEHOLDER%5F%5F", || Ok(PathBuf::from("/x")));
        assert_eq!(r, Ok(PathBuf::from("/x")));
    }

    #[test]
    fn default_save_dir_prefers_xdg_pictures_then_home() {
        assert_eq!(
            default_save_dir(Some("/home/u/Imágenes".into()), Some("/home/u".into()), "Capturas de pantalla"),
            Ok(PathBuf::from("/home/u/Imágenes/Capturas de pantalla"))
        );
        assert_eq!(
            default_save_dir(None, Some("/home/u".into()), "Screenshots"),
            Ok(PathBuf::from("/home/u/Pictures/Screenshots"))
        );
        assert!(default_save_dir(None, None, "Screenshots").is_err());
        assert!(default_save_dir(Some("relativa".into()), Some(String::new()), "Screenshots").is_err());
    }

    #[test]
    fn safe_folder_name_keeps_a_plain_translation_and_falls_back_otherwise() {
        assert_eq!(safe_folder_name("Capturas de pantalla"), "Capturas de pantalla");
        assert_eq!(safe_folder_name("Captures d’écran"), "Captures d’écran");
        for bad in ["", "   ", ".", "..", "a/b", "/abs", "x%2Fy", "nul\0", "con\nsalto"] {
            assert_eq!(safe_folder_name(bad), "Screenshots", "{bad:?}");
        }
    }

    #[test]
    fn tilde_form_shortens_only_paths_inside_home() {
        let home = "/home/u";
        assert_eq!(tilde_form(Path::new("/home/u/Imágenes/Capturas de pantalla"), home), "~/Imágenes/Capturas de pantalla");
        assert_eq!(tilde_form(Path::new("/home/u"), home), "~");
        // «/home/uu» no está dentro de «/home/u», y fuera de HOME se deja absoluta.
        assert_eq!(tilde_form(Path::new("/home/uu/x"), home), "/home/uu/x");
        assert_eq!(tilde_form(Path::new("/data/Fotos/Screenshots"), home), "/data/Fotos/Screenshots");
    }

    #[test]
    fn tilde_form_round_trips_through_resolve_save_dir() {
        let home = std::env::var("HOME").unwrap_or_default();
        if home.is_empty() {
            return;
        }
        let dir = Path::new(&home).join("Imágenes").join("Capturas de pantalla");
        assert_eq!(resolve_save_dir(&tilde_form(&dir, &home)), Ok(dir));
    }

    #[test]
    fn save_capture_decodes_url_encoded_dir() {
        let dir = tmp();
        let encoded = format!("{}/Im%C3%A1genes", dir.display());
        let saved = save_capture_impl(&pending(), &png(2, 2), &encoded, "s").unwrap();
        assert!(saved.contains("Imágenes"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copy_capture_validates_then_consumes_pending_once() {
        let p = pending();
        let mut got = 0usize;
        let ok = copy_capture_impl(&p, &png(4, 4), |b| {
            got = b.len();
            Ok(())
        });
        assert!(ok.is_ok() && got > 0);
        assert!(copy_capture_impl(&p, &png(4, 4), |_| Ok(())).is_err());
    }

    #[test]
    fn copy_capture_rejects_invalid_and_restores_pending_on_failure() {
        let p = pending();
        assert!(copy_capture_impl(&p, b"no-png", |_| Ok(())).is_err());
        assert!(p.lock().unwrap().is_some());
        let r = copy_capture_impl(&p, &png(4, 4), |_| Err("sin display".into()));
        assert!(r.is_err());
        assert!(p.lock().unwrap().is_some());
    }

    #[test]
    fn local_stamp_has_expected_shape() {
        let s = local_stamp();
        assert_eq!(s.len(), 15);
        assert_eq!(s.as_bytes()[8], b'-');
    }

    #[test]
    fn default_save_as_name_matches_the_no_dialog_scheme() {
        assert_eq!(
            default_save_as_name("20261014-101500"),
            "knivchit-20261014-101500.png"
        );
    }

    #[test]
    fn chosen_save_path_rejects_relative_parent_dir_and_nul() {
        for bad in ["relativa.png", "/tmp/../escape.png", "/tmp/a\0b.png"] {
            assert!(
                validate_chosen_save_path(Path::new(bad)).is_err(),
                "debía rechazar {bad:?}"
            );
        }
    }

    #[test]
    fn chosen_save_path_accepts_a_plain_absolute_path() {
        assert!(validate_chosen_save_path(Path::new("/home/u/Pictures/knivchit-x.png")).is_ok());
    }

    #[test]
    fn chosen_save_path_rejects_empty_and_other_relative_forms() {
        for bad in ["", "relativa/x.png", "./x.png", "~/x.png"] {
            assert!(
                validate_chosen_save_path(Path::new(bad)).is_err(),
                "debía rechazar {bad:?}"
            );
        }
    }

    #[test]
    fn chosen_save_path_rejects_a_parent_dir_component_anywhere() {
        for bad in ["/a/../b.png", "/a/b/../../c.png", "/../etc/x.png"] {
            assert!(
                validate_chosen_save_path(Path::new(bad)).is_err(),
                "debía rechazar {bad:?}"
            );
        }
    }

    #[test]
    fn chosen_save_path_allows_literal_dots_that_are_not_a_parent_component() {
        // ".." solo cuenta como componente exacto; "a..b" es un nombre válido.
        for ok in ["/tmp/..png", "/tmp/a..b.png", "/tmp/...png"] {
            assert!(
                validate_chosen_save_path(Path::new(ok)).is_ok(),
                "no debía rechazar {ok:?}"
            );
        }
    }

    #[test]
    fn chosen_save_path_allows_whitespace_segments_the_portal_may_return() {
        // A diferencia de resolve_save_dir (texto tipeado por el usuario), esta
        // ruta ya la eligió el portal nativo: un segmento de solo espacios es un
        // nombre de carpeta/archivo válido en Linux, no "vacío".
        assert!(validate_chosen_save_path(Path::new("/tmp/   /x.png")).is_ok());
    }

    #[test]
    fn default_save_as_name_matches_the_first_attempt_filename_save_png_would_use() {
        let stamp = "20261014-120000";
        let dir = tmp();
        let saved = save_png(b"x", &dir, stamp).unwrap();
        assert_eq!(
            saved.file_name().unwrap().to_str().unwrap(),
            default_save_as_name(stamp)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
