//! `get_capture_permission` por el IPC simulado de Tauri: forma exacta del
//! JSON que lee el hub.

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;

use knivchit_lib::capture_permission::{CaptureErrorCode, CapturePermission};

fn call(permission: CapturePermission) -> serde_json::Value {
    let app = mock_builder()
        .manage(permission)
        .invoke_handler(tauri::generate_handler![knivchit_lib::commands::capture_flow::get_capture_permission])
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    tauri::test::get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "get_capture_permission".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(serde_json::json!({})),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .unwrap()
    .deserialize()
    .unwrap()
}

#[test]
fn reports_not_granted_with_a_null_error_by_default() {
    let dir = std::env::temp_dir().join(format!("knivchit-permipc-{}", uuid::Uuid::new_v4()));
    assert_eq!(call(CapturePermission::new(&dir)), serde_json::json!({ "granted": false, "last_error": null }));
}

#[test]
fn reports_the_last_error_as_a_stable_code_and_the_granted_flag() {
    let dir = std::env::temp_dir().join(format!("knivchit-permipc-{}", uuid::Uuid::new_v4()));
    let permission = CapturePermission::new(&dir);
    permission.record_error(Some(CaptureErrorCode::NeedsPermission));
    assert_eq!(call(permission), serde_json::json!({ "granted": false, "last_error": "needs_permission" }));

    let granted = CapturePermission::new(&dir);
    granted.set_granted(true).unwrap();
    assert_eq!(call(granted), serde_json::json!({ "granted": true, "last_error": null }));
    let _ = std::fs::remove_dir_all(&dir);
}
