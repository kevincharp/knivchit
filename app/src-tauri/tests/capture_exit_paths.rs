//! Vías de salida de una captura con runtime simulado: cancelar y guardar responden y consumen la
//! captura pendiente, y un error de validación la conserva para reintentar. Con y sin
//! `CaptureActivity` registrada. (El runtime simulado no refleja `hide()`/`show()` en
//! `is_visible()`, así que aquí no se observa qué ventana se muestra.)

mod common;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindowBuilder};
use knivchit_lib::commands::capture_flow::{CaptureActivity, CaptureState};

use common::*;

type App = tauri::App<tauri::test::MockRuntime>;
type Win = tauri::WebviewWindow<tauri::test::MockRuntime>;

fn build(with_activity: bool, pending: bool) -> (App, Win) {
    let mut b = mock_builder()
        .manage(memory_pool())
        .manage(CaptureState(Mutex::new(
            pending.then(|| PathBuf::from("/tmp/p.png")),
        )));
    if with_activity {
        b = b.manage(CaptureActivity::default());
    }
    let app = b
        .invoke_handler(tauri::generate_handler![
            knivchit_lib::commands::capture_flow::cancel_capture,
            knivchit_lib::commands::output::save_capture,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, main)
}

fn invoke(
    w: &Win,
    cmd: &str,
    body: InvokeBody,
    headers: tauri::http::HeaderMap,
) -> Result<(), String> {
    tauri::test::get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body,
            headers,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn pending_set(app: &App) -> bool {
    app.state::<CaptureState>().0.lock().unwrap().is_some()
}

#[test]
fn cancel_discards_the_pending_capture_and_closes_the_flow() {
    let (app, main) = build(true, true);

    invoke(
        &main,
        "cancel_capture",
        InvokeBody::Json(serde_json::json!({})),
        Default::default(),
    )
    .expect("cancel_capture debe responder");
    assert!(!pending_set(&app), "y descarta la captura pendiente");
}

#[test]
fn cancel_works_without_the_activity_state_registered() {
    let (app, main) = build(false, true);
    invoke(
        &main,
        "cancel_capture",
        InvokeBody::Json(serde_json::json!({})),
        Default::default(),
    )
    .expect("sin CaptureActivity tampoco debe fallar");
    assert!(!pending_set(&app));
}

#[test]
fn cancel_twice_is_harmless() {
    let (app, main) = build(true, true);
    for _ in 0..2 {
        invoke(
            &main,
            "cancel_capture",
            InvokeBody::Json(serde_json::json!({})),
            Default::default(),
        )
        .unwrap();
    }
    assert!(!pending_set(&app));
}

#[test]
fn saving_closes_the_flow_and_consumes_the_pending_capture() {
    let (app, main) = build(true, true);
    let tmp = TempDir::new();
    set_save_dir(&main.state::<sqlx::SqlitePool>(), tmp.path().to_str().unwrap());

    invoke(&main, "save_capture", InvokeBody::Raw(png(3, 3)), Default::default()).expect("debe guardar");
    assert!(!pending_set(&app));
    assert_eq!(tmp.file_names().len(), 1);
}

#[test]
fn a_failed_save_keeps_the_capture_pending() {
    let (app, main) = build(true, true);
    set_save_dir(&main.state::<sqlx::SqlitePool>(), "relativa");

    assert!(invoke(&main, "save_capture", InvokeBody::Raw(png(3, 3)), Default::default()).is_err());
    assert!(
        pending_set(&app),
        "un error de validación deja la captura pendiente"
    );
}
