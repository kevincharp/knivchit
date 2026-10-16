//! Salir de Knivchit. Cerrar la ventana principal NO termina el proceso (a
//! propósito: sigue atendiendo el atajo y el servidor D-Bus), así que la
//! salida explícita es el botón «Salir de Knivchit» de Ajustes.

use tauri::{AppHandle, Manager, Runtime};

use super::capture_flow::{cancel_capture_impl, CaptureState, OVERLAY_LABEL};
use super::pin::PIN_PREFIX;

/// Deja la app sin trabajo a medias antes de salir: descarta la captura
/// pendiente (borra su recorte temporal 0600) y destruye el overlay y los pins.
/// Una petición ya enviada al portal XDG no se puede cancelar; al salir el
/// proceso, el portal la descarta por sí solo.
pub fn prepare_quit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<CaptureState>() {
        cancel_capture_impl(&state.0);
    }
    for (label, window) in app.webview_windows() {
        if closes_on_quit(&label) {
            let _ = window.destroy();
        }
    }
}

/// «main» no se destruye a mano: la cierra el propio proceso al salir.
fn closes_on_quit(label: &str) -> bool {
    label == OVERLAY_LABEL || label.starts_with(PIN_PREFIX)
}

/// Sale con código 0 (`ExitRequested { code: Some(0) }`, que `should_prevent_exit`
/// deja pasar). Después, abrir Knivchit desde el lanzador arranca una instancia
/// nueva: el nombre `org.knivchit.App` queda libre al terminar el proceso.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    prepare_quit(&app);
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::WebviewWindowBuilder;

    #[test]
    fn only_the_overlay_and_the_pins_are_closed_on_quit() {
        assert!(closes_on_quit(OVERLAY_LABEL));
        assert!(closes_on_quit("pin-123e4567-e89b-12d3-a456-426614174000"));
        assert!(!closes_on_quit("main"));
    }

    #[test]
    fn prepare_quit_discards_the_pending_capture() {
        let app = mock_builder()
            .manage(CaptureState(Mutex::new(Some(PathBuf::from("/tmp/no-es-un-recorte-propio.png")))))
            .build(mock_context(noop_assets()))
            .unwrap();
        for label in [OVERLAY_LABEL, "main"] {
            WebviewWindowBuilder::new(&app, label, Default::default()).build().unwrap();
        }

        prepare_quit(app.handle());

        assert!(app.state::<CaptureState>().0.lock().unwrap().is_none());
    }

    #[test]
    fn prepare_quit_works_without_any_managed_state_or_window() {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        prepare_quit(app.handle());
    }
}
