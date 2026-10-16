//! Acceso al portal de capturas: el flujo «preparación» y la foto.
//!
//! GNOME pide permiso la primera vez que una app lanzada desde su `.desktop`
//! captura la pantalla, y solo muestra ese aviso a la app que tiene el FOCO.
//! El flujo normal OCULTA la ventana principal antes de pedir la foto (para que
//! no salga en ella), así que sin permiso previo no habría ventana enfocada.
//! De ahí el modo preparación: con la ventana visible y enfocada se pide una
//! primera foto de prueba, se descarta (contiene la propia ventana) y se
//! recuerda que el permiso está concedido.
//!
//! La lógica es genérica sobre `CaptureEnv` para probarla con un portal y unas
//! ventanas simulados; `capture_flow::AppEnv` es la implementación real.

use std::path::{Path, PathBuf};

use crate::capture::PortalFailure;
use crate::capture_permission::CaptureErrorCode;

/// Quién pidió la captura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// El botón de la ventana principal (ya tiene el foco).
    Button,
    /// El atajo global de la extensión (puede haber otra app enfocada).
    Shortcut,
}

#[allow(async_fn_in_trait)]
pub trait CaptureEnv {
    fn granted(&self) -> bool;
    fn set_granted(&self, granted: bool);
    /// Guarda el último error (o lo limpia con `None`) y avisa al hub.
    fn record(&self, error: Option<CaptureErrorCode>);
    /// Muestra la ventana principal y espera (acotado) a que tenga el foco.
    async fn show_main_focused(&self);
    /// Oculta la ventana principal y espera a que el compositor la retire.
    async fn hide_main_and_settle(&self);
    /// Pide una foto al portal; `with_parent`: anclarla a la ventana principal.
    async fn photo(&self, with_parent: bool) -> Result<PathBuf, PortalFailure>;
    /// Borra la foto que dejó el portal.
    fn discard(&self, photo: &Path);
}

/// Modo preparación: pide permiso con la ventana principal visible y enfocada.
/// Una foto correcta se descarta; el permiso queda marcado como concedido.
pub async fn request_permission<E: CaptureEnv>(env: &E) -> Result<(), CaptureErrorCode> {
    env.show_main_focused().await;
    match env.photo(true).await {
        Ok(photo) => {
            env.discard(&photo);
            env.set_granted(true);
            env.record(None);
            Ok(())
        }
        Err(failure) => {
            let code = failure.code();
            env.record(Some(code));
            Err(code)
        }
    }
}

/// Consigue la foto de pantalla completa para un pedido de captura.
///
/// - Sin permiso y desde el atajo: no se intenta el portal a ciegas; se trae la
///   ventana principal y se avisa «necesita permiso».
/// - Sin permiso y desde el botón: primero el modo preparación.
/// - Con permiso: oculta la ventana, espera y pide la foto. Si el portal falla
///   se vuelve a mostrar la ventana principal con el error; un acceso denegado
///   (permiso revocado) desmarca el permiso para que el siguiente intento
///   pase por el modo preparación.
pub async fn acquire_photo<E: CaptureEnv>(env: &E, trigger: Trigger) -> Result<PathBuf, CaptureErrorCode> {
    if !env.granted() {
        match trigger {
            Trigger::Shortcut => {
                env.show_main_focused().await;
                env.record(Some(CaptureErrorCode::NeedsPermission));
                return Err(CaptureErrorCode::NeedsPermission);
            }
            Trigger::Button => request_permission(env).await?,
        }
    }
    env.hide_main_and_settle().await;
    match env.photo(false).await {
        Ok(photo) => Ok(photo),
        Err(failure) => {
            let code = failure.code();
            if code == CaptureErrorCode::Denied {
                env.set_granted(false);
            }
            env.show_main_focused().await;
            env.record(Some(code));
            Err(code)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::collections::VecDeque;

    /// Entorno simulado: anota cada operación y responde con un guion.
    struct Fake {
        granted: Cell<bool>,
        script: RefCell<VecDeque<Result<PathBuf, PortalFailure>>>,
        calls: RefCell<Vec<String>>,
    }

    impl Fake {
        fn new(granted: bool, script: Vec<Result<PathBuf, PortalFailure>>) -> Self {
            Self { granted: Cell::new(granted), script: RefCell::new(script.into()), calls: RefCell::new(vec![]) }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
        fn log(&self, what: &str) {
            self.calls.borrow_mut().push(what.to_string());
        }
    }

    impl CaptureEnv for Fake {
        fn granted(&self) -> bool {
            self.granted.get()
        }
        fn set_granted(&self, granted: bool) {
            self.log(&format!("granted={granted}"));
            self.granted.set(granted);
        }
        fn record(&self, error: Option<CaptureErrorCode>) {
            self.log(&format!("record={error:?}"));
        }
        async fn show_main_focused(&self) {
            self.log("show_main");
        }
        async fn hide_main_and_settle(&self) {
            self.log("hide_main");
        }
        async fn photo(&self, with_parent: bool) -> Result<PathBuf, PortalFailure> {
            self.log(&format!("photo(parent={with_parent})"));
            self.script.borrow_mut().pop_front().expect("el guion se quedó sin respuestas")
        }
        fn discard(&self, photo: &Path) {
            self.log(&format!("discard={}", photo.display()));
        }
    }

    fn ok(name: &str) -> Result<PathBuf, PortalFailure> {
        Ok(PathBuf::from(name))
    }

    #[tokio::test]
    async fn already_granted_hides_main_waits_and_takes_the_photo() {
        let env = Fake::new(true, vec![ok("/p/1.png")]);
        let photo = acquire_photo(&env, Trigger::Button).await.unwrap();
        assert_eq!(photo, PathBuf::from("/p/1.png"));
        assert_eq!(env.calls(), ["hide_main", "photo(parent=false)"]);
    }

    #[tokio::test]
    async fn button_without_permission_prepares_first_then_takes_the_real_photo() {
        // portal: 0 = ok (foto de prueba), 0 = ok (foto real)
        let env = Fake::new(false, vec![ok("/p/prueba.png"), ok("/p/real.png")]);
        let photo = acquire_photo(&env, Trigger::Button).await.unwrap();
        assert_eq!(photo, PathBuf::from("/p/real.png"));
        assert_eq!(
            env.calls(),
            [
                "show_main",
                "photo(parent=true)",
                "discard=/p/prueba.png",
                "granted=true",
                "record=None",
                "hide_main",
                "photo(parent=false)",
            ],
            "main visible para el aviso, foto de prueba descartada y después el flujo normal"
        );
        assert!(env.granted());
    }

    #[tokio::test]
    async fn preparation_cancelled_by_the_user_is_a_clear_error_and_nothing_is_hidden() {
        // portal: 1 = cancelado
        let env = Fake::new(false, vec![Err(PortalFailure::Cancelled)]);
        assert_eq!(acquire_photo(&env, Trigger::Button).await, Err(CaptureErrorCode::Cancelled));
        assert_eq!(env.calls(), ["show_main", "photo(parent=true)", "record=Some(Cancelled)"]);
        assert!(!env.granted());
    }

    #[tokio::test]
    async fn preparation_denied_by_gnome_is_reported_as_denied() {
        // portal: 2 = otro / denegado
        let env = Fake::new(false, vec![Err(PortalFailure::Denied)]);
        assert_eq!(acquire_photo(&env, Trigger::Button).await, Err(CaptureErrorCode::Denied));
        assert!(!env.granted());
        assert!(!env.calls().contains(&"hide_main".to_string()));
    }

    #[tokio::test]
    async fn preparation_without_a_portal_is_reported_as_unavailable() {
        let env = Fake::new(false, vec![Err(PortalFailure::Unavailable)]);
        assert_eq!(acquire_photo(&env, Trigger::Button).await, Err(CaptureErrorCode::PortalUnavailable));
    }

    #[tokio::test]
    async fn shortcut_without_permission_never_calls_the_portal_blindly() {
        let env = Fake::new(false, vec![]);
        assert_eq!(acquire_photo(&env, Trigger::Shortcut).await, Err(CaptureErrorCode::NeedsPermission));
        assert_eq!(env.calls(), ["show_main", "record=Some(NeedsPermission)"]);
    }

    #[tokio::test]
    async fn revoked_permission_unmarks_it_and_shows_main_again() {
        let env = Fake::new(true, vec![Err(PortalFailure::Denied)]);
        assert_eq!(acquire_photo(&env, Trigger::Shortcut).await, Err(CaptureErrorCode::Denied));
        assert_eq!(
            env.calls(),
            ["hide_main", "photo(parent=false)", "granted=false", "show_main", "record=Some(Denied)"]
        );
        assert!(!env.granted(), "el siguiente intento pasará por el modo preparación");
    }

    #[tokio::test]
    async fn a_cancelled_or_unavailable_photo_keeps_the_permission_but_main_is_never_left_hidden() {
        for failure in [PortalFailure::Cancelled, PortalFailure::Unavailable] {
            let env = Fake::new(true, vec![Err(failure)]);
            assert!(acquire_photo(&env, Trigger::Button).await.is_err());
            assert!(env.granted(), "{failure:?}");
            let calls = env.calls();
            let hide = calls.iter().position(|c| c == "hide_main").unwrap();
            let show = calls.iter().rposition(|c| c == "show_main").unwrap();
            assert!(show > hide, "{failure:?}: main se vuelve a mostrar tras ocultarla");
        }
    }

    #[tokio::test]
    async fn request_permission_alone_grants_and_discards_the_probe_photo() {
        let env = Fake::new(false, vec![ok("/p/prueba.png")]);
        request_permission(&env).await.unwrap();
        assert!(env.granted());
        assert_eq!(
            env.calls(),
            ["show_main", "photo(parent=true)", "discard=/p/prueba.png", "granted=true", "record=None"]
        );
    }

    #[tokio::test]
    async fn after_a_revocation_the_next_attempt_goes_through_preparation_again() {
        let env = Fake::new(true, vec![Err(PortalFailure::Denied), ok("/p/prueba.png"), ok("/p/real.png")]);
        assert!(acquire_photo(&env, Trigger::Button).await.is_err());
        assert!(!env.granted());
        let photo = acquire_photo(&env, Trigger::Button).await.unwrap();
        assert_eq!(photo, PathBuf::from("/p/real.png"));
        assert!(env.granted());
    }
}
