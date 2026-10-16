//! Estado del permiso de captura de pantalla del portal XDG.
//!
//! La primera vez que una app lanzada desde su `.desktop` pide una captura,
//! GNOME muestra un aviso de permiso — y solo lo muestra a la app que tiene el
//! FOCO. Por eso la primera petición se hace en «modo preparación» (con la
//! ventana principal visible y enfocada) y, cuando el portal responde bien, se
//! recuerda aquí que el permiso está concedido. El dato vive en un archivo
//! marcador del directorio de datos (0600), no en SQLite: no toca migraciones.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;

const MARKER_NAME: &str = "capture-permission-granted";

/// Por qué no hay (o dejó de haber) permiso. Cadenas estables para el hub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureErrorCode {
    /// Falta conceder el permiso: el hub muestra «Permitir capturas».
    NeedsPermission,
    /// El usuario cerró el aviso del portal sin decidir.
    Cancelled,
    /// GNOME no dio permiso (rechazado o revocado).
    Denied,
    /// No hay portal de capturas disponible.
    PortalUnavailable,
}

impl CaptureErrorCode {
    /// Código estable (el mismo que se serializa): lo que reciben los
    /// comandos que rechazan por permiso.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NeedsPermission => "needs_permission",
            Self::Cancelled => "cancelled",
            Self::Denied => "denied",
            Self::PortalUnavailable => "portal_unavailable",
        }
    }

    /// Mensaje accionable en español, sin datos sensibles.
    pub fn user_message(self) -> &'static str {
        match self {
            Self::NeedsPermission => {
                "Knivchit necesita permiso para capturar la pantalla. Pulsa “Permitir capturas” y acepta el aviso."
            }
            Self::Cancelled => "Captura cancelada.",
            Self::Denied => {
                "GNOME no ha dado permiso para capturar la pantalla. Pulsa “Permitir capturas” y acepta el aviso; si lo rechazaste antes, restablece con: flatpak permission-reset knivchit"
            }
            Self::PortalUnavailable => {
                "No hay un portal de capturas disponible (xdg-desktop-portal). Instálalo e inicia sesión de nuevo."
            }
        }
    }
}

/// Estado serializado hacia el hub (`get_capture_permission`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CapturePermissionState {
    pub granted: bool,
    pub last_error: Option<CaptureErrorCode>,
}

pub struct CapturePermission {
    marker: PathBuf,
    last_error: Mutex<Option<CaptureErrorCode>>,
    requesting: AtomicBool,
}

/// Mientras vive, hay una petición de permiso en curso (solo una a la vez).
pub struct RequestingGuard<'a>(&'a AtomicBool);

impl Drop for RequestingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl CapturePermission {
    pub fn new(data_dir: &Path) -> Self {
        Self { marker: data_dir.join(MARKER_NAME), last_error: Mutex::new(None), requesting: AtomicBool::new(false) }
    }

    /// `true` si está marcado como concedido (un enlace simbólico no cuenta).
    pub fn granted(&self) -> bool {
        fs::symlink_metadata(&self.marker).map(|m| m.is_file()).unwrap_or(false)
    }

    /// Marca o desmarca el permiso. Marcar crea el archivo 0600 (y limpia el
    /// último error); desmarcar lo borra (que no exista no es un error).
    pub fn set_granted(&self, granted: bool) -> io::Result<()> {
        if granted {
            use std::os::unix::fs::OpenOptionsExt;
            if let Some(parent) = self.marker.parent() {
                fs::create_dir_all(parent)?;
            }
            match fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&self.marker) {
                Ok(_) => {}
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e),
            }
            self.record_error(None);
            Ok(())
        } else {
            match fs::remove_file(&self.marker) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e),
            }
        }
    }

    /// `None` si ya hay otra petición de permiso en curso (un doble clic no
    /// debe abrir dos avisos del portal).
    pub fn begin_request(&self) -> Option<RequestingGuard<'_>> {
        self.requesting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| RequestingGuard(&self.requesting))
    }

    pub fn record_error(&self, code: Option<CaptureErrorCode>) {
        if let Ok(mut last) = self.last_error.lock() {
            *last = code;
        }
    }

    pub fn state(&self) -> CapturePermissionState {
        CapturePermissionState {
            granted: self.granted(),
            last_error: self.last_error.lock().ok().and_then(|g| *g),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let d = std::env::temp_dir().join(format!("knivchit-perm-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn starts_not_granted_and_survives_a_restart_once_granted() {
        let dir = scratch();
        assert!(!CapturePermission::new(&dir).granted());
        CapturePermission::new(&dir).set_granted(true).unwrap();
        // otra instancia del estado (otro arranque) lo ve
        assert!(CapturePermission::new(&dir).granted());
        CapturePermission::new(&dir).set_granted(false).unwrap();
        assert!(!CapturePermission::new(&dir).granted());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_marker_is_private_idempotent_and_creates_the_data_dir() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch();
        let dir = root.join("nuevo/datos");
        let p = CapturePermission::new(&dir);
        p.set_granted(true).unwrap();
        p.set_granted(true).unwrap();
        let mode = fs::metadata(dir.join(MARKER_NAME)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        p.set_granted(false).unwrap();
        p.set_granted(false).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_symlink_or_a_directory_in_place_of_the_marker_does_not_count() {
        let dir = scratch();
        let outside = dir.join("fuera");
        fs::write(&outside, b"x").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join(MARKER_NAME)).unwrap();
        assert!(!CapturePermission::new(&dir).granted());
        fs::remove_file(dir.join(MARKER_NAME)).unwrap();
        fs::create_dir(dir.join(MARKER_NAME)).unwrap();
        assert!(!CapturePermission::new(&dir).granted());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_one_permission_request_at_a_time() {
        let dir = scratch();
        let p = CapturePermission::new(&dir);
        let first = p.begin_request().expect("la primera entra");
        assert!(p.begin_request().is_none(), "la segunda espera");
        drop(first);
        assert!(p.begin_request().is_some(), "libre otra vez");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn granting_clears_the_last_error_and_state_reports_both() {
        let dir = scratch();
        let p = CapturePermission::new(&dir);
        p.record_error(Some(CaptureErrorCode::Denied));
        assert_eq!(
            p.state(),
            CapturePermissionState { granted: false, last_error: Some(CaptureErrorCode::Denied) }
        );
        p.set_granted(true).unwrap();
        assert_eq!(p.state(), CapturePermissionState { granted: true, last_error: None });
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn error_codes_serialize_as_stable_snake_case_and_messages_are_actionable() {
        let json = |c| serde_json::to_string(&c).unwrap();
        assert_eq!(json(CaptureErrorCode::NeedsPermission), "\"needs_permission\"");
        assert_eq!(json(CaptureErrorCode::PortalUnavailable), "\"portal_unavailable\"");
        assert!(CaptureErrorCode::Denied.user_message().contains("flatpak permission-reset knivchit"));
        assert!(CaptureErrorCode::Denied.user_message().contains("Permitir capturas"));
        assert_eq!(CaptureErrorCode::Cancelled.user_message(), "Captura cancelada.");
    }
}
