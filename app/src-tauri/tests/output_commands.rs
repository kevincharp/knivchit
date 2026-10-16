//! Validación de la salida de captura (criterios de la salida de captura) escrita desde los
//! criterios de aceptación, usando solo la API pública del crate y el IPC
//! simulado de Tauri. Helpers y tabla de casos: `tests/common/mod.rs`.

mod common;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};
use knivchit_lib::commands::capture_flow::CaptureState;
use knivchit_lib::commands::output::{
    copy_capture_impl, save_png, validate_png, with_pending, MAX_DIMENSION, MAX_PNG_BYTES,
};
use knivchit_lib::commands::pin::{
    get_pin_image_impl, is_valid_pin_label, parse_logical_size, PinState,
};

use common::*;

// ---------------------------------------------------------------- validate_png

#[test]
fn constants_match_the_spec() {
    assert_eq!(MAX_PNG_BYTES, MAX_BYTES);
    assert_eq!(MAX_DIMENSION, MAX_SIDE);
}

#[test]
fn validate_png_accepts_a_real_png_and_reports_its_size() {
    assert_eq!(validate_png(&png(30, 20)), Ok((30, 20)));
}

#[test]
fn validate_png_rejects_every_non_png_case() {
    for (name, bytes) in NOT_PNG_CASES {
        assert!(validate_png(bytes).is_err(), "debería rechazar: {name}");
    }
}

#[test]
fn validate_png_rejects_a_png_renamed_from_other_format_bytes() {
    // firma de JPEG delante de un cuerpo largo: el tamaño no la hace válida
    let mut body = vec![0xFF, 0xD8, 0xFF, 0xE0];
    body.resize(4096, 7);
    assert!(validate_png(&body).is_err());
}

// Un PNG cortado a la mitad conserva firma e IHDR, pero no es una imagen
// completa: debe rechazarse (exige el chunk IEND). Rojo hasta que backend lo publique.
#[test]
fn validate_png_rejects_a_truncated_png() {
    assert!(validate_png(&truncated_png()).is_err());
}

#[test]
fn validate_png_size_limit_is_exactly_64_mib() {
    assert!(
        validate_png(&padded_png(MAX_BYTES)).is_ok(),
        "64 MiB exactos"
    );
    assert!(
        validate_png(&padded_png(MAX_BYTES + 1)).is_err(),
        "64 MiB + 1"
    );
}

#[test]
fn validate_png_dimension_limit_is_exactly_16384_per_side() {
    assert_eq!(validate_png(&png(MAX_SIDE, 1)), Ok((MAX_SIDE, 1)));
    assert_eq!(validate_png(&png(1, MAX_SIDE)), Ok((1, MAX_SIDE)));
    assert!(validate_png(&png(MAX_SIDE + 1, 1)).is_err(), "ancho 16385");
    assert!(validate_png(&png(1, MAX_SIDE + 1)).is_err(), "alto 16385");
}

#[test]
fn validate_png_error_messages_do_not_echo_the_content() {
    let secret = b"CONTRASENA-SUPER-SECRETA-no-soy-png";
    let err = validate_png(secret).unwrap_err();
    assert!(!err.contains("CONTRASENA"));
}

// -------------------------------------------------------------------- save_png

#[test]
fn save_png_writes_the_exact_bytes_with_the_stamped_name() {
    let tmp = TempDir::new();
    let bytes = png(5, 5);
    let path = save_png(&bytes, tmp.path(), "20261013-101500").unwrap();
    assert_eq!(path.file_name().unwrap(), "knivchit-20261013-101500.png");
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert_eq!(png_size_on_disk(&path), (5, 5));
}

#[test]
fn save_png_never_overwrites_and_suffixes_with_n() {
    let tmp = TempDir::new();
    let names: Vec<String> = (0..4)
        .map(|i| {
            let p = save_png(&[i as u8], tmp.path(), "20261013-101500").unwrap();
            p.file_name().unwrap().to_string_lossy().into_owned()
        })
        .collect();
    assert_eq!(
        names,
        [
            "knivchit-20261013-101500.png",
            "knivchit-20261013-101500-1.png",
            "knivchit-20261013-101500-2.png",
            "knivchit-20261013-101500-3.png",
        ]
    );
    for (i, n) in names.iter().enumerate() {
        assert_eq!(std::fs::read(tmp.path().join(n)).unwrap(), vec![i as u8]);
    }
}

#[test]
fn save_png_creates_a_missing_nested_directory() {
    let tmp = TempDir::new();
    let dir = tmp.path().join("a/b/c");
    let path = save_png(b"x", &dir, "s").unwrap();
    assert!(path.starts_with(&dir) && path.exists());
}

#[test]
fn save_png_supports_spaces_accents_and_percent_in_the_directory() {
    let tmp = TempDir::new();
    let dir = tmp.path().join(SAVE_DIR_AWKWARD);
    let path = save_png(b"x", &dir, "s").unwrap();
    assert!(path.exists());
}

#[test]
fn save_png_fails_when_the_destination_is_a_file() {
    let tmp = TempDir::new();
    let file = tmp.path().join("soy-un-archivo");
    std::fs::write(&file, b"x").unwrap();
    assert!(save_png(b"x", &file, "s").is_err());
    assert!(save_png(b"x", &file.join("sub"), "s").is_err());
}

#[test]
fn save_png_concurrent_saves_in_the_same_second_never_collide() {
    let tmp = TempDir::new();
    let dir = tmp.path().to_path_buf();
    let handles: Vec<_> = (0..16u8)
        .map(|i| {
            let dir = dir.clone();
            std::thread::spawn(move || save_png(&[i], &dir, "mismo-segundo").unwrap())
        })
        .collect();
    let mut paths: Vec<PathBuf> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    paths.sort();
    paths.dedup();
    assert_eq!(
        paths.len(),
        16,
        "cada guardado debe tener un nombre distinto"
    );
    assert_eq!(tmp.file_names().len(), 16);
}

// ---------------------------------------------------------------- with_pending

fn pending() -> Mutex<Option<PathBuf>> {
    Mutex::new(Some(PathBuf::from("/tmp/pendiente.png")))
}

#[test]
fn pending_capture_is_consumed_once_on_success() {
    let p = pending();
    assert_eq!(with_pending(&p, || Ok(1)), Ok(1));
    assert!(p.lock().unwrap().is_none());
    assert!(with_pending(&p, || Ok(2)).is_err(), "segunda vez: error");
}

#[test]
fn pending_capture_is_restored_when_the_action_fails() {
    let p = pending();
    assert!(with_pending::<()>(&p, || Err("falló".into())).is_err());
    assert!(p.lock().unwrap().is_some());
    assert!(with_pending(&p, || Ok(())).is_ok(), "se puede reintentar");
}

#[test]
fn without_a_pending_capture_the_action_never_runs() {
    let p: Mutex<Option<PathBuf>> = Mutex::new(None);
    let ran = AtomicUsize::new(0);
    let r = with_pending(&p, || {
        ran.fetch_add(1, Ordering::SeqCst);
        Ok(())
    });
    assert!(r.is_err());
    assert_eq!(ran.load(Ordering::SeqCst), 0);
}

#[test]
fn concurrent_calls_consume_the_pending_capture_exactly_once() {
    let p = Arc::new(pending());
    let wins = Arc::new(AtomicUsize::new(0));
    let handles: Vec<_> = (0..16)
        .map(|_| {
            let (p, wins) = (p.clone(), wins.clone());
            std::thread::spawn(move || {
                if with_pending(&p, || Ok(())).is_ok() {
                    wins.fetch_add(1, Ordering::SeqCst);
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(wins.load(Ordering::SeqCst), 1);
}

// ------------------------------------------------------------------ pin labels

#[test]
fn pin_label_must_be_pin_dash_uuid() {
    let uuid = "123e4567-e89b-12d3-a456-426614174000";
    assert!(is_valid_pin_label(&format!("pin-{uuid}")));
    for bad in [
        "",
        "pin-",
        "pin",
        "main",
        "capture-overlay",
        "pin-no-es-uuid",
        "pin-../../etc/passwd",
        "PIN-123e4567-e89b-12d3-a456-426614174000",
        &format!("pin-{uuid}?x=1"),
        &format!(" pin-{uuid}"),
        &format!("pin-{uuid}/../main"),
    ] {
        assert!(!is_valid_pin_label(bad), "debería rechazar {bad:?}");
    }
}

// ------------------------------------------------- IPC real (runtime simulado)

fn webview_with_pending(
    pending: Option<&str>,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    WebviewWindow<tauri::test::MockRuntime>,
) {
    let app = mock_builder()
        .manage(CaptureState(Mutex::new(pending.map(PathBuf::from))))
        .manage(memory_pool())
        .invoke_handler(tauri::generate_handler![
            knivchit_lib::commands::output::save_capture,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, webview)
}

fn invoke(
    webview: &WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: InvokeBody,
    headers: &[(&'static str, String)],
) -> Result<String, String> {
    let mut map = tauri::http::HeaderMap::new();
    for (k, v) in headers {
        map.insert(*k, v.parse().unwrap());
    }
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body,
            headers: map,
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<String>().unwrap())
    .map_err(|e| {
        e.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| e.to_string())
    })
}

fn save(
    webview: &WebviewWindow<tauri::test::MockRuntime>,
    bytes: Vec<u8>,
    dir: &str,
) -> Result<String, String> {
    set_save_dir(&webview.state::<sqlx::SqlitePool>(), dir);
    invoke(webview, "save_capture", InvokeBody::Raw(bytes), &[])
}

fn pending_is_set(app: &tauri::App<tauri::test::MockRuntime>) -> bool {
    app.state::<CaptureState>().0.lock().unwrap().is_some()
}

#[test]
fn save_capture_via_ipc_writes_the_png_and_consumes_the_pending_capture_once() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    let tmp = TempDir::new();
    let dir = tmp.path().join(SAVE_DIR_AWKWARD);
    let bytes = png(12, 9);

    let path = save(&webview, bytes.clone(), dir.to_str().unwrap()).unwrap();
    assert!(path.starts_with(dir.to_str().unwrap()));
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    assert_eq!(png_size_on_disk(path.as_ref()), (12, 9));
    assert!(!pending_is_set(&app), "la captura pendiente se consume");

    let again = save(&webview, bytes, dir.to_str().unwrap());
    assert!(
        again.is_err(),
        "sin captura nueva, la segunda llamada falla"
    );
    assert_eq!(
        tmp.path()
            .join(SAVE_DIR_AWKWARD)
            .read_dir()
            .unwrap()
            .count(),
        1
    );
}

#[test]
fn save_capture_via_ipc_rejects_invalid_bodies_without_writing_or_consuming() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    let tmp = TempDir::new();
    let dir = tmp.path().join("salida");
    let d = dir.to_str().unwrap();

    for (name, bytes) in NOT_PNG_CASES {
        assert!(save(&webview, bytes.to_vec(), d).is_err(), "{name}");
    }
    assert!(
        save(&webview, padded_png(MAX_BYTES + 1), d).is_err(),
        "tamaño"
    );
    assert!(save(&webview, png(MAX_SIDE + 1, 1), d).is_err(), "ancho");
    assert!(save(&webview, png(1, MAX_SIDE + 1), d).is_err(), "alto");

    assert!(!dir.exists(), "no se creó ni la carpeta");
    assert!(pending_is_set(&app), "la captura sigue pendiente");
}

#[test]
fn save_capture_via_ipc_requires_a_non_empty_configured_save_dir() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    assert!(save(&webview, png(2, 2), "").is_err(), "vacío");
    assert!(pending_is_set(&app));
}

// Seguridad: la carpeta sale de los ajustes; un header `x-save-dir` del
// webview se ignora y no puede redirigir la escritura.
#[test]
fn save_capture_via_ipc_ignores_the_x_save_dir_header() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    let configurada = TempDir::new();
    let atacante = TempDir::new();
    set_save_dir(&webview.state::<sqlx::SqlitePool>(), configurada.path().to_str().unwrap());

    let path = invoke(
        &webview,
        "save_capture",
        InvokeBody::Raw(png(2, 2)),
        &[("x-save-dir", encode_uri_component(atacante.path().to_str().unwrap()))],
    )
    .unwrap();
    assert!(path.starts_with(configurada.path().to_str().unwrap()), "{path}");
    assert!(atacante.file_names().is_empty(), "escribió donde mandó el header");
    assert!(!pending_is_set(&app));
}

#[test]
fn save_capture_via_ipc_rejects_a_json_body() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    let r = invoke(
        &webview,
        "save_capture",
        InvokeBody::Json(serde_json::json!({ "png": [1, 2, 3] })),
        &[],
    );
    assert!(r.is_err());
    assert!(pending_is_set(&app));
}

#[test]
fn save_capture_via_ipc_keeps_pending_when_the_directory_is_unusable() {
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));
    let tmp = TempDir::new();
    let file = tmp.path().join("archivo");
    std::fs::write(&file, b"x").unwrap();
    let r = save(&webview, png(2, 2), file.join("sub").to_str().unwrap());
    assert!(r.is_err());
    assert!(pending_is_set(&app), "se puede reintentar sin recapturar");
}

// `~` se resuelve contra HOME. Un solo test toca el entorno del proceso.
#[test]
fn save_capture_via_ipc_resolves_tilde_against_home() {
    let home = TempDir::new();
    // SAFETY: único test de este binario que modifica el entorno.
    unsafe { std::env::set_var("HOME", home.path()) };
    let (_app, webview) = webview_with_pending(Some("/tmp/p.png"));

    let path = save(&webview, png(3, 3), "~/Pictures/Capturas").unwrap();
    let esperado = home.path().join("Pictures/Capturas");
    assert!(path.starts_with(esperado.to_str().unwrap()), "{path}");
    assert!(
        !PathBuf::from("~").exists(),
        "no creó una carpeta literal «~»"
    );
}

// Defecto detectado por esta suite: el backend comprueba `trim().is_empty()`
// ANTES de decodificar el porcentaje, así que «%20%20» llega en blanco a
// `save_png` y crea una carpeta relativa al directorio de trabajo. Por eso se rechaza save_dir en blanco, relativo, con `..` o con NUL.
// El cwd se fija en un directorio temporal para que nada toque el repo.
#[test]
fn save_capture_via_ipc_rejects_unsafe_save_dirs_and_creates_nothing() {
    let cwd = TempDir::new();
    std::env::set_current_dir(cwd.path()).unwrap();
    let area = TempDir::new();
    let (app, webview) = webview_with_pending(Some("/tmp/p.png"));

    let con_punto_punto = format!("{}/a/../escapa", area.path().display());
    let casos: [(&str, &str); 7] = [
        ("en blanco", "   "),
        ("tabulador", "\t"),
        ("relativo", "relativo/sub"),
        ("relativo con punto", "./sub"),
        ("padre", "../fuera"),
        ("absoluto con ..", &con_punto_punto),
        ("con NUL", "/tmp/nul\0dir"),
    ];
    for (nombre, dir) in casos {
        let r = save(&webview, png(2, 2), dir);
        assert!(r.is_err(), "save_dir {nombre} ({dir:?}) debería rechazarse");
    }
    assert!(
        cwd.file_names().is_empty(),
        "escribió en el cwd: {:?}",
        cwd.file_names()
    );
    assert!(
        area.file_names().is_empty(),
        "escribió en {:?}",
        area.file_names()
    );
    assert!(pending_is_set(&app), "la captura sigue pendiente");
}

// ------------------------------------------------------------ copy_capture_impl

#[test]
fn copy_capture_delivers_the_exact_bytes_and_consumes_pending_once() {
    let p = pending();
    let bytes = png(6, 4);
    let mut recibido: Vec<u8> = Vec::new();
    let r = copy_capture_impl(&p, &bytes, |b| {
        recibido = b.to_vec();
        Ok(())
    });
    assert!(r.is_ok());
    assert_eq!(recibido, bytes);
    assert!(p.lock().unwrap().is_none());

    let mut llamado = false;
    let otra = copy_capture_impl(&p, &bytes, |_| {
        llamado = true;
        Ok(())
    });
    assert!(otra.is_err(), "sin captura nueva, la segunda copia falla");
    assert!(!llamado, "y no llega a tocar el portapapeles");
}

#[test]
fn copy_capture_rejects_invalid_png_without_copying_or_consuming() {
    let casos: Vec<(String, Vec<u8>)> = NOT_PNG_CASES
        .iter()
        .map(|(n, b)| (n.to_string(), b.to_vec()))
        .chain([
            ("truncado".into(), truncated_png()),
            ("ancho excesivo".into(), png(MAX_SIDE + 1, 1)),
            ("alto excesivo".into(), png(1, MAX_SIDE + 1)),
            ("tamaño excesivo".into(), padded_png(MAX_BYTES + 1)),
        ])
        .collect();
    for (nombre, bytes) in casos {
        let p = pending();
        let mut llamado = false;
        let r = copy_capture_impl(&p, &bytes, |_| {
            llamado = true;
            Ok(())
        });
        assert!(r.is_err(), "{nombre}");
        assert!(!llamado, "{nombre}: no debe copiar");
        assert!(p.lock().unwrap().is_some(), "{nombre}: sigue pendiente");
    }
}

#[test]
fn copy_capture_restores_pending_when_the_clipboard_fails() {
    let p = pending();
    let r = copy_capture_impl(&p, &png(3, 3), |_| Err("sin display".into()));
    assert_eq!(r, Err("sin display".to_string()));
    assert!(p.lock().unwrap().is_some());
    assert!(copy_capture_impl(&p, &png(3, 3), |_| Ok(())).is_ok());
}

#[test]
fn copy_capture_accepts_the_size_limits_exactly() {
    assert!(copy_capture_impl(&pending(), &png(MAX_SIDE, 1), |_| Ok(())).is_ok());
    assert!(copy_capture_impl(&pending(), &padded_png(MAX_BYTES), |_| Ok(())).is_ok());
}

// ------------------------------------------------- pin: tamaño lógico e imagen

fn size_headers(w: &str, h: &str) -> tauri::http::HeaderMap {
    let mut m = tauri::http::HeaderMap::new();
    m.insert("x-width", w.parse().unwrap());
    m.insert("x-height", h.parse().unwrap());
    m
}

#[test]
fn pin_logical_size_parses_valid_values() {
    assert_eq!(
        parse_logical_size(&size_headers("320", "200")),
        Ok((320, 200))
    );
    assert_eq!(
        parse_logical_size(&size_headers(" 1 ", "16384")),
        Ok((1, 16384))
    );
}

#[test]
fn pin_logical_size_rejects_bad_values() {
    for (w, h) in [
        ("0", "200"),
        ("200", "0"),
        ("16385", "200"),
        ("200", "16385"),
        ("-5", "200"),
        ("abc", "200"),
        ("3.5", "200"),
        ("", "200"),
        ("99999999999", "200"),
    ] {
        assert!(
            parse_logical_size(&size_headers(w, h)).is_err(),
            "x-width={w:?} x-height={h:?}"
        );
    }
}

#[test]
fn pin_logical_size_requires_both_headers() {
    assert!(parse_logical_size(&tauri::http::HeaderMap::new()).is_err());
    let mut solo_ancho = tauri::http::HeaderMap::new();
    solo_ancho.insert("x-width", "10".parse().unwrap());
    assert!(parse_logical_size(&solo_ancho).is_err());
}

#[test]
fn pin_image_is_served_as_a_png_data_url_for_its_own_label_only() {
    let pins = PinState::default();
    let label_a = "pin-123e4567-e89b-12d3-a456-426614174000";
    let label_b = "pin-223e4567-e89b-12d3-a456-426614174000";
    pins.0.lock().unwrap().insert(label_a.into(), vec![1, 2, 3]);

    let url = get_pin_image_impl(&pins, label_a).unwrap();
    assert_eq!(url, "data:image/png;base64,AQID");
    assert!(get_pin_image_impl(&pins, label_b).is_err(), "otro label");
    assert!(get_pin_image_impl(&pins, "").is_err());
    assert!(get_pin_image_impl(&pins, "main").is_err());
}

#[test]
fn pin_image_round_trips_a_real_png() {
    use base64::Engine;
    let pins = PinState::default();
    let bytes = png(9, 5);
    pins.0.lock().unwrap().insert("pin-x".into(), bytes.clone());
    let url = get_pin_image_impl(&pins, "pin-x").unwrap();
    let b64 = url.strip_prefix("data:image/png;base64,").unwrap();
    let back = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .unwrap();
    assert_eq!(back, bytes);
}

// ------------------------------------------------ límites de recursos (seguridad)

/// PNG mínimo con la cabecera IHDR reescrita: `validate_png` no decodifica,
/// así que permite probar dimensiones enormes sin fabricar la imagen.
fn png_with_declared_size(w: u32, h: u32) -> Vec<u8> {
    let mut bytes = png(1, 1);
    bytes[16..20].copy_from_slice(&w.to_be_bytes());
    bytes[20..24].copy_from_slice(&h.to_be_bytes());
    bytes
}

#[test]
fn validate_png_caps_the_total_megapixels() {
    use knivchit_lib::commands::output::MAX_PIXELS;
    // 10000×10000 = 100 MP exactos: acepta; un píxel más: rechaza.
    assert!(validate_png(&png_with_declared_size(10_000, 10_000)).is_ok());
    assert!(validate_png(&png_with_declared_size(10_000, 10_000 + 1)).is_err());
    // El máximo por lado solo no basta: 16384×16384 ≈ 268 MP.
    assert!(validate_png(&png_with_declared_size(MAX_SIDE, MAX_SIDE)).is_err());
    assert_eq!(MAX_PIXELS, 100_000_000);
}

#[test]
fn saved_captures_are_private_to_the_user() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = TempDir::new();
    let path = save_png(&png(2, 2), tmp.path(), "20261015-101500").unwrap();
    assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn pin_capture_refuses_more_than_the_maximum_number_of_pins() {
    use knivchit_lib::commands::pin::MAX_PINS;
    let app = mock_builder()
        .manage(CaptureState(Mutex::new(Some(PathBuf::from("/tmp/p.png")))))
        .manage(PinState::default())
        .invoke_handler(tauri::generate_handler![knivchit_lib::commands::pin::pin_capture])
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "capture-overlay", Default::default())
        .build()
        .unwrap();
    for i in 0..MAX_PINS {
        app.state::<PinState>().0.lock().unwrap().insert(format!("pin-{i}"), vec![0]);
    }

    let r = invoke(
        &webview,
        "pin_capture",
        InvokeBody::Raw(png(2, 2)),
        &[("x-width", "2".into()), ("x-height", "2".into())],
    );
    assert!(r.is_err(), "con {MAX_PINS} pins abiertos no se admite otro");
    assert!(pending_is_set(&app), "la captura sigue pendiente");
    assert_eq!(app.state::<PinState>().0.lock().unwrap().len(), MAX_PINS);
}
