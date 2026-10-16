//! Comprueba que el cuerpo raw + headers llega intacto a los comandos de
//! salida a través del IPC real de Tauri (runtime simulado).

mod common;

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;
use knivchit_lib::commands::capture_flow::CaptureState;
use knivchit_lib::commands::output;

fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(w, h, image::Rgba([1, 2, 3, 255]));
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

#[test]
fn save_capture_receives_raw_body_through_invoke() {
    let dir = std::env::temp_dir().join(format!("knivchit-ipc-{}", uuid::Uuid::new_v4()));
    let pool = common::memory_pool();
    common::set_save_dir(&pool, dir.to_str().unwrap());
    let app = mock_builder()
        .manage(CaptureState(std::sync::Mutex::new(Some("/tmp/p.png".into()))))
        .manage(pool.clone())
        .invoke_handler(tauri::generate_handler![output::save_capture])
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let headers = tauri::http::HeaderMap::new();
    let bytes = png(5, 5);

    let res = tauri::test::get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: "save_capture".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Raw(bytes.clone()),
            headers,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<String>().unwrap());

    let path = res.expect("el comando debe aceptar el cuerpo raw");
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let _ = std::fs::remove_dir_all(&dir);
}
