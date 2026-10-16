//! Ventanas «pin»: la captura fijada flotando sobre el escritorio. Cada pin
//! es una ventana `pin-<uuid>` sin decoración; su PNG vive en `PinState`
//! hasta `close_pin` (o hasta que la ventana se destruya por otra vía).

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine;
use tauri::ipc::Request;
use tauri::{
    AppHandle, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use super::capture_flow::{finish_capture_ui, CaptureState};
use crate::monitors::CaptureOutcome;
use super::output::{raw_body, validate_png, with_pending, header_str, MAX_DIMENSION};

pub const PIN_PREFIX: &str = "pin-";
/// Máximo de pins abiertos a la vez: cada uno retiene su PNG (hasta 64 MiB).
pub const MAX_PINS: usize = 20;
const PIN_TITLE: &str = "knivchit-pin";

#[derive(Default)]
pub struct PinState(pub Mutex<HashMap<String, Vec<u8>>>);

/// Un label válido es exactamente `pin-<uuid>`; evita que un argumento
/// arbitrario llegue a la URL de la ventana o al mapa.
pub fn is_valid_pin_label(label: &str) -> bool {
    label
        .strip_prefix(PIN_PREFIX)
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok())
}

/// Solo la propia ventana `pin-*` puede pedir su imagen o cerrarse.
fn check_caller(window: &WebviewWindow, label: &str) -> Result<(), String> {
    if !is_valid_pin_label(label) || window.label() != label {
        return Err("label de pin no válido para esta ventana".to_string());
    }
    Ok(())
}

/// `pub` para que los tests de integración la ejerzan sin una ventana real.
pub fn parse_logical_size(headers: &tauri::http::HeaderMap) -> Result<(u32, u32), String> {
    let parse = |name: &str| -> Result<u32, String> {
        let v: u32 = header_str(headers, name)?
            .trim()
            .parse()
            .map_err(|_| format!("el header {name} no es un entero"))?;
        if v == 0 || v > MAX_DIMENSION {
            return Err(format!("el header {name} está fuera de rango"));
        }
        Ok(v)
    };
    Ok((parse("x-width")?, parse("x-height")?))
}

fn data_url(png: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

/// `pub` para que los tests de integración la ejerzan sin una ventana real.
pub fn get_pin_image_impl(pins: &PinState, label: &str) -> Result<String, String> {
    let map = pins.0.lock().map_err(|e| e.to_string())?;
    map.get(label)
        .map(|png| data_url(png))
        .ok_or_else(|| "no existe ese pin".to_string())
}

fn release_pin(pins: &PinState, label: &str) {
    if let Ok(mut map) = pins.0.lock() {
        map.remove(label);
    }
}

#[tauri::command]
pub async fn pin_capture<R: Runtime>(
    app: AppHandle<R>,
    request: Request<'_>,
    capture: State<'_, CaptureState>,
    pins: State<'_, PinState>,
) -> Result<String, String> {
    let bytes = raw_body(&request)?;
    validate_png(bytes)?;
    let (width, height) = parse_logical_size(request.headers())?;

    let label = format!("{PIN_PREFIX}{}", uuid::Uuid::new_v4());
    with_pending(&capture.0, || {
        {
            let mut map = pins.0.lock().map_err(|e| e.to_string())?;
            if map.len() >= MAX_PINS {
                return Err(format!("hay demasiadas capturas fijadas (máximo {MAX_PINS})"));
            }
            map.insert(label.clone(), bytes.to_vec());
        }
        let built = WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App(format!("index.html?window=pin&label={label}").into()),
        )
        .title(PIN_TITLE)
        .inner_size(width as f64, height as f64)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .background_color(crate::WINDOW_BACKGROUND)
        .on_navigation(crate::navigation::allow_navigation)
        .build();
        match built {
            Ok(window) => {
                let handle = app.clone();
                let owned = label.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Destroyed) {
                        release_pin(&handle.state::<PinState>(), &owned);
                    }
                });
                Ok(())
            }
            Err(e) => {
                release_pin(&pins, &label);
                Err(e.to_string())
            }
        }
    })?;
    finish_capture_ui(&app, CaptureOutcome::Pinned);
    Ok(label)
}

#[tauri::command]
pub fn get_pin_image(
    window: WebviewWindow,
    pins: State<'_, PinState>,
    label: String,
) -> Result<String, String> {
    check_caller(&window, &label)?;
    get_pin_image_impl(&pins, &label)
}

#[tauri::command]
pub fn close_pin(
    window: WebviewWindow,
    pins: State<'_, PinState>,
    label: String,
) -> Result<(), String> {
    check_caller(&window, &label)?;
    release_pin(&pins, &label);
    window.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::http::{HeaderMap, HeaderValue};

    fn headers(w: &str, h: &str) -> HeaderMap {
        let mut m = HeaderMap::new();
        m.insert("x-width", HeaderValue::from_str(w).unwrap());
        m.insert("x-height", HeaderValue::from_str(h).unwrap());
        m
    }

    #[test]
    fn label_must_be_pin_plus_uuid() {
        let ok = format!("pin-{}", uuid::Uuid::new_v4());
        assert!(is_valid_pin_label(&ok));
        for bad in ["", "pin-", "pin-xyz", "main", "capture-overlay", "pin-../x"] {
            assert!(!is_valid_pin_label(bad), "{bad}");
        }
    }

    #[test]
    fn logical_size_parses_and_bounds_checks() {
        assert_eq!(parse_logical_size(&headers("320", "200")), Ok((320, 200)));
        assert!(parse_logical_size(&headers("0", "200")).is_err());
        assert!(parse_logical_size(&headers("320", "16385")).is_err());
        assert!(parse_logical_size(&headers("abc", "200")).is_err());
        assert!(parse_logical_size(&HeaderMap::new()).is_err());
    }

    #[test]
    fn pin_image_is_served_until_released() {
        let pins = PinState::default();
        pins.0.lock().unwrap().insert("pin-a".into(), vec![1, 2, 3]);
        let url = get_pin_image_impl(&pins, "pin-a").unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        release_pin(&pins, "pin-a");
        assert!(get_pin_image_impl(&pins, "pin-a").is_err());
    }
}
