use ashpd::desktop::screenshot::ScreenshotRequest;
use ashpd::WindowIdentifier;
use crate::capture_permission::CaptureErrorCode;
use crate::monitors::CropRect;
use std::path::{Path, PathBuf};

#[derive(Debug, serde::Serialize)]
pub struct CaptureResult {
    pub uri: String,
}

/// Por qué falló una petición al portal, ya clasificado para el flujo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PortalFailure {
    /// El usuario cerró el aviso del portal sin decidir.
    Cancelled,
    /// El portal rechazó la petición (permiso denegado o revocado).
    Denied,
    /// No hay portal de capturas, o no contesta.
    Unavailable,
}

impl PortalFailure {
    pub fn code(self) -> CaptureErrorCode {
        match self {
            Self::Cancelled => CaptureErrorCode::Cancelled,
            Self::Denied => CaptureErrorCode::Denied,
            Self::Unavailable => CaptureErrorCode::PortalUnavailable,
        }
    }
}

/// Clasifica el error de ashpd. `Response::Other` es lo que devuelve el portal
/// cuando GNOME no concede el permiso («Portal request didn't succeed»).
pub fn classify_portal_error(error: &ashpd::Error) -> PortalFailure {
    use ashpd::desktop::ResponseError;
    use ashpd::{Error, PortalError};
    match error {
        Error::Response(ResponseError::Cancelled) | Error::Portal(PortalError::Cancelled(_)) => {
            PortalFailure::Cancelled
        }
        Error::Response(ResponseError::Other) | Error::Portal(PortalError::NotAllowed(_)) => {
            PortalFailure::Denied
        }
        Error::Zbus(zbus::Error::FDO(inner)) if matches!(**inner, zbus::fdo::Error::AccessDenied(_)) => {
            PortalFailure::Denied
        }
        Error::Zbus(zbus::Error::MethodError(name, _, _))
            if name.as_str() == "org.freedesktop.DBus.Error.AccessDenied" =>
        {
            PortalFailure::Denied
        }
        _ => PortalFailure::Unavailable,
    }
}

/// Pide la captura al portal XDG (`org.freedesktop.portal.Screenshot`), que
/// es portable entre GNOME/KDE/wlroots y no depende de la extensión GNOME.
/// Captura la pantalla completa SIN el picker nativo del compositor
/// (`interactive(false)`) — el portal devuelve la imagen casi al instante,
/// sin dibujar ningún selector propio. Esta es la base del recortador: la
/// selección de región la dibuja Knivchit encima de esta foto ya congelada,
/// no en vivo sobre el escritorio (Wayland no lo permite para apps
/// sandboxeadas: un overlay propio sobre una foto ya tomada es la única vía).
///
/// `parent` es la ventana a la que el portal ancla su aviso de permiso; sin
/// él GNOME no puede asociar el diálogo («Failed to associate portal window
/// with parent window»). Debe vivir hasta que la petición termine.
pub async fn capture_full_screen(
    parent: Option<WindowIdentifier>,
) -> Result<CaptureResult, PortalFailure> {
    let response = ScreenshotRequest::default()
        .connection(crate::portal::connection().await)
        .identifier(parent)
        .interactive(false)
        .send()
        .await
        .and_then(|request| request.response())
        .map_err(|e| classify_portal_error(&e))?;

    Ok(CaptureResult {
        uri: response.uri().to_string(),
    })
}

/// Lo que se necesita de la ventana nativa para identificarla ante el portal.
/// Son números (no punteros) para poder moverlos entre hilos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RawParent {
    X11(u64),
    Wayland { surface: usize, display: usize },
}

/// Debe llamarse en el hilo principal.
fn raw_parent<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> Option<RawParent> {
    use raw_window_handle::{HasDisplayHandle, HasWindowHandle, RawDisplayHandle, RawWindowHandle};
    match window.window_handle().ok()?.as_raw() {
        RawWindowHandle::Xlib(h) => Some(RawParent::X11(h.window as u64)),
        RawWindowHandle::Xcb(h) => Some(RawParent::X11(u64::from(h.window.get()))),
        RawWindowHandle::Wayland(h) => match window.display_handle().ok()?.as_raw() {
            RawDisplayHandle::Wayland(d) => Some(RawParent::Wayland {
                surface: h.surface.as_ptr() as usize,
                display: d.display.as_ptr() as usize,
            }),
            _ => None,
        },
        _ => None,
    }
}

/// Identificador de la ventana `label` para el portal: XID bajo X11, handle
/// exportado (xdg-foreign) bajo Wayland. Cualquier fallo da `None` y la
/// petición sigue sin ventana padre.
pub async fn parent_identifier<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> Option<WindowIdentifier> {
    use tauri::Manager;
    let window = app.get_webview_window(label)?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(raw_parent(&window));
    })
    .ok()?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(2)).ok().flatten())
        .await
        .ok()??;
    match raw {
        RawParent::X11(xid) => Some(WindowIdentifier::from_xid(xid as std::os::raw::c_ulong)),
        // La futura de ashpd no es `Send` (guarda punteros crudos): se resuelve en un
        // hilo de bloqueo con su propio `block_on`; el identificador resultante sí es `Send`.
        RawParent::Wayland { surface, display } => {
            tauri::async_runtime::spawn_blocking(move || {
                tauri::async_runtime::block_on(async move {
                    // SAFETY: ambos punteros salen de la ventana y el display vivos de Tauri, que
                    // sobreviven a la petición (el identificador se suelta al terminar el envío).
                    unsafe {
                        WindowIdentifier::from_wayland_raw(
                            surface as *mut std::ffi::c_void,
                            display as *mut std::ffi::c_void,
                        )
                        .await
                    }
                })
            })
            .await
            .ok()?
        }
    }
}

/// El portal devuelve un `file://` URI (posiblemente con caracteres
/// percent-encoded, p. ej. tildes) — lo convertimos a un `PathBuf` real.
pub fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    let raw = uri
        .strip_prefix("file://")
        .ok_or_else(|| format!("uri inesperada del portal (no es file://): {uri}"))?;
    let decoded = percent_decode(raw);
    Ok(PathBuf::from(decoded))
}

/// Decodifica `%XX`; una secuencia inválida o truncada se deja tal cual.
/// Opera sobre bytes (no sobre `&str`) para no entrar en pánico si lo que
/// sigue a un `%` es un carácter multibyte.
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Prefijo de los PNG temporales que genera `crop_to_rect`; permite borrar
/// solo esos y nunca el archivo original del portal.
pub const CROP_TEMP_PREFIX: &str = "knivchit-crop-";

/// Carpeta de los temporales: `XDG_RUNTIME_DIR` (privada del usuario) si
/// existe, y si no el directorio temporal del sistema.
pub fn crop_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

/// Recorta `source` a `rect` y guarda SIEMPRE el resultado como PNG propio
/// (`CROP_TEMP_PREFIX`, permisos 0600) en `dir`, aunque el rectángulo cubra
/// toda la imagen: así el llamador puede borrar el original del portal.
pub fn crop_to_rect_in(source: &Path, rect: CropRect, dir: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::OpenOptionsExt;

    let img = image::open(source).map_err(|e| format!("no se pudo leer la captura: {e}"))?;
    if rect.width == 0
        || rect.height == 0
        || rect.x + rect.width > img.width()
        || rect.y + rect.height > img.height()
    {
        return Err("el monitor queda fuera de la imagen capturada".to_string());
    }
    let dest = dir.join(format!("{CROP_TEMP_PREFIX}{}.png", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&dest)
        .map_err(|e| format!("no se pudo crear el temporal de la captura: {e}"))?;
    let result = img
        .crop_imm(rect.x, rect.y, rect.width, rect.height)
        .write_to(&mut file, image::ImageFormat::Png);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&dest);
        return Err(format!("no se pudo guardar el recorte del monitor: {e}"));
    }
    Ok(dest)
}

pub fn crop_to_rect(source: &Path, rect: CropRect) -> Result<PathBuf, String> {
    crop_to_rect_in(source, rect, &crop_dir())
}

/// Borra el archivo que el portal escribió para ESTA captura. Si falla no
/// aborta: registra solo el tipo de error, nunca la ruta ni el contenido.
pub fn remove_portal_original(path: &Path) {
    if let Err(e) = std::fs::remove_file(path) {
        eprintln!("knivchit: no se pudo borrar el original del portal ({:?})", e.kind());
    }
}

fn is_own_temp(path: &Path, dir: &Path) -> bool {
    path.parent() == Some(dir)
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with(CROP_TEMP_PREFIX))
}

/// Borra el PNG pendiente solo si es un recorte temporal nuestro.
pub fn discard_if_temp_crop(path: &Path) {
    if is_own_temp(path, &crop_dir()) {
        let _ = std::fs::remove_file(path);
    }
}

/// Al arrancar: elimina `knivchit-crop-*` huérfanos de un cierre abrupto
/// (en la carpeta actual y en la temporal del sistema, por versiones
/// anteriores). Solo archivos con el prefijo propio.
pub fn remove_orphan_crops() {
    for dir in [crop_dir(), std::env::temp_dir()] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if is_own_temp(&path, &dir) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ashpd::desktop::screenshot::ScreenshotRequest;

    #[test]
    fn screenshot_request_builder_sets_interactive() {
        // No hay portal real en el entorno de build — este test verifica que el
        // builder de ashpd acepta y aplica .interactive(true) sin panickear,
        // no que la llamada al portal en si funcione (eso se prueba a mano).
        let _request = ScreenshotRequest::default().interactive(true).modal(true);
        // Si ashpd cambia esta API en una version futura, este test deja de
        // compilar en vez de fallar en runtime — es la señal correcta.
    }

    #[test]
    fn uri_to_path_decodes_percent_encoded_accents() {
        let path = uri_to_path("file:///home/user/Im%C3%A1genes/Screenshot.png").unwrap();
        assert_eq!(
            path,
            std::path::PathBuf::from("/home/user/Imágenes/Screenshot.png")
        );
    }

    #[test]
    fn percent_decode_survives_multibyte_after_percent_sign() {
        assert_eq!(percent_decode("a%aé"), "a%aé");
        assert_eq!(percent_decode("%41%"), "A%");
        assert_eq!(percent_decode("x%C3%A1"), "xá");
    }

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("knivchit-croptest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn crop_to_rect_writes_a_private_png_with_the_monitor_region() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch();
        let source = dir.join("source.png");
        image::RgbaImage::from_pixel(300, 100, image::Rgba([1, 2, 3, 255]))
            .save(&source)
            .unwrap();

        let cropped = crop_to_rect_in(&source, CropRect { x: 100, y: 0, width: 200, height: 100 }, &dir).unwrap();
        let out = image::open(&cropped).unwrap();
        assert_eq!((out.width(), out.height()), (200, 100));
        assert_eq!(std::fs::metadata(&cropped).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(is_own_temp(&cropped, &dir));

        // imagen completa: también genera su propio temporal (el original se podrá borrar)
        let whole = crop_to_rect_in(&source, CropRect { x: 0, y: 0, width: 300, height: 100 }, &dir).unwrap();
        assert_ne!(whole, source);
        assert!(crop_to_rect_in(&source, CropRect { x: 250, y: 0, width: 100, height: 100 }, &dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn removing_the_portal_original_leaves_the_temp_and_other_files_alone() {
        let dir = scratch();
        let original = dir.join("Screenshot-portal.png");
        let neighbour = dir.join("Screenshot-otra.png");
        for p in [&original, &neighbour] {
            image::RgbaImage::from_pixel(10, 10, image::Rgba([1, 2, 3, 255])).save(p).unwrap();
        }
        let temp = crop_to_rect_in(&original, CropRect { x: 0, y: 0, width: 10, height: 10 }, &dir).unwrap();
        remove_portal_original(&original);
        assert!(!original.exists());
        assert!(temp.exists() && neighbour.exists());
        // borrar algo que ya no existe no aborta
        remove_portal_original(&original);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_own_temp_only_matches_prefixed_files_in_the_given_dir() {
        let dir = PathBuf::from("/run/user/1000");
        assert!(is_own_temp(&dir.join("knivchit-crop-abc.png"), &dir));
        assert!(!is_own_temp(&dir.join("Screenshot.png"), &dir));
        assert!(!is_own_temp(Path::new("/home/u/Imágenes/knivchit-crop-x.png"), &dir));
    }

    #[test]
    fn uri_to_path_rejects_non_file_scheme() {
        let result = uri_to_path("http://example.com/x.png");
        assert!(result.is_err());
    }

    #[test]
    fn portal_errors_are_classified_for_the_flow() {
        use ashpd::desktop::ResponseError;
        use ashpd::Error;
        assert_eq!(classify_portal_error(&Error::Response(ResponseError::Cancelled)), PortalFailure::Cancelled);
        assert_eq!(classify_portal_error(&Error::Response(ResponseError::Other)), PortalFailure::Denied);
        assert_eq!(
            classify_portal_error(&Error::Portal(ashpd::PortalError::NotAllowed("x".into()))),
            PortalFailure::Denied
        );
        assert_eq!(
            classify_portal_error(&Error::Portal(ashpd::PortalError::Cancelled("x".into()))),
            PortalFailure::Cancelled
        );
        let access_denied = Error::Zbus(zbus::Error::FDO(Box::new(zbus::fdo::Error::AccessDenied("x".into()))));
        assert_eq!(classify_portal_error(&access_denied), PortalFailure::Denied);
        assert_eq!(classify_portal_error(&Error::NoResponse), PortalFailure::Unavailable);
        assert_eq!(
            classify_portal_error(&Error::Zbus(zbus::Error::Failure("sin portal".into()))),
            PortalFailure::Unavailable
        );
    }

    #[test]
    fn each_failure_maps_to_its_stable_code() {
        assert_eq!(PortalFailure::Cancelled.code(), CaptureErrorCode::Cancelled);
        assert_eq!(PortalFailure::Denied.code(), CaptureErrorCode::Denied);
        assert_eq!(PortalFailure::Unavailable.code(), CaptureErrorCode::PortalUnavailable);
    }
}
