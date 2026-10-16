//! Regresión de instalación nueva: pulsar ↓ ANTES de aceptar el onboarding
//! deja `screenshot_save_dir` en el valor por defecto `__PLACEHOLDER__`.
//! Debe guardarse en «Imágenes/Knivchit» del usuario, sin crear nada hasta
//! el guardado, y toda variante del placeholder sigue siendo un error.
//! HOME y XDG_* apuntan a directorios temporales: nunca se tocan los reales.

mod common;

use std::cell::Cell;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{mock_builder, mock_context, noop_assets, INVOKE_KEY};
use tauri::webview::InvokeRequest;
use tauri::WebviewWindowBuilder;
use knivchit_lib::commands::capture_flow::CaptureState;
use knivchit_lib::commands::output::{
    default_save_dir, resolve_save_dir, resolve_save_dir_with, SAVE_DIR_PLACEHOLDER,
};

use common::*;

// ------------------------------------------------- resolución pura (sin entorno)

#[test]
fn the_placeholder_constant_is_the_documented_value() {
    assert_eq!(SAVE_DIR_PLACEHOLDER, "__PLACEHOLDER__");
}

#[test]
fn exact_placeholder_resolves_to_the_default_dir_in_both_encodings() {
    for raw in ["__PLACEHOLDER__", "%5F%5FPLACEHOLDER%5F%5F"] {
        let r = resolve_save_dir_with(raw, || Ok(PathBuf::from("/x/Pictures/Knivchit")));
        assert_eq!(r, Ok(PathBuf::from("/x/Pictures/Knivchit")), "{raw}");
    }
}

#[test]
fn placeholder_variants_are_errors_and_never_ask_for_the_default() {
    let consultado = Cell::new(false);
    for raw in [
        "",
        "   ",
        "%20%20%20",
        "\t",
        "__placeholder__",
        "__PLACEHOLDER__/x",
        "__PLACEHOLDER__ ",
        " __PLACEHOLDER__",
        "__PLACEHOLDER",
        "PLACEHOLDER",
        "x/__PLACEHOLDER__",
        "relativa/carpeta",
        "./x",
        "../x",
        "/tmp/../etc",
        "/tmp/%2e%2e/etc",
        "/tmp/a\0b",
        "/tmp/a%00b",
    ] {
        let r = resolve_save_dir_with(raw, || {
            consultado.set(true);
            Ok(PathBuf::from("/default"))
        });
        assert!(r.is_err(), "debería ser error: {raw:?} → {r:?}");
    }
    assert!(
        !consultado.get(),
        "una variante no debe usar la carpeta por defecto"
    );
}

#[test]
fn regular_absolute_dirs_are_untouched_and_never_use_the_default() {
    let r = resolve_save_dir_with("/home/u/Capturas", || panic!("no debe consultarse"));
    assert_eq!(r, Ok(PathBuf::from("/home/u/Capturas")));
    let r = resolve_save_dir_with("%2Fhome%2Fu%2FIm%C3%A1genes", || {
        panic!("no debe consultarse")
    });
    assert_eq!(r, Ok(PathBuf::from("/home/u/Imágenes")));
}

#[test]
fn a_failing_default_lookup_is_propagated_only_for_the_placeholder() {
    let r = resolve_save_dir_with(SAVE_DIR_PLACEHOLDER, || Err("sin carpeta".into()));
    assert_eq!(r, Err("sin carpeta".to_string()));
}

#[test]
fn default_save_dir_prefers_an_absolute_xdg_pictures_dir() {
    let r = default_save_dir(Some(PathBuf::from("/data/Fotos")), Some("/home/u".into()));
    assert_eq!(r, Ok(PathBuf::from("/data/Fotos/Knivchit")));
}

#[test]
fn default_save_dir_falls_back_to_home_pictures() {
    assert_eq!(
        default_save_dir(None, Some("/home/u".into())),
        Ok(PathBuf::from("/home/u/Pictures/Knivchit"))
    );
    // una carpeta XDG relativa no es de fiar
    assert_eq!(
        default_save_dir(Some(PathBuf::from("relativa")), Some("/home/u".into())),
        Ok(PathBuf::from("/home/u/Pictures/Knivchit"))
    );
}

#[test]
fn default_save_dir_fails_without_xdg_and_without_a_usable_home() {
    assert!(default_save_dir(None, None).is_err());
    assert!(default_save_dir(None, Some(String::new())).is_err());
    assert!(default_save_dir(Some(PathBuf::from("rel")), None).is_err());
}

// --------------------------------------- extremo a extremo con HOME/XDG temporales

fn save_via_ipc(
    webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    dir: &str,
) -> Result<String, String> {
    set_save_dir(&webview.state::<sqlx::SqlitePool>(), dir);
    let headers = tauri::http::HeaderMap::new();
    tauri::test::get_ipc_response(
        webview,
        InvokeRequest {
            cmd: "save_capture".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Raw(png(4, 4)),
            headers,
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

// Un solo test toca el entorno del proceso (HOME y XDG_*), y glib cachea los
// directorios la primera vez que se consultan.
#[test]
fn placeholder_saves_into_the_default_pictures_dir_and_creates_nothing_before_saving() {
    let home = TempDir::new();
    let config = TempDir::new();
    let pictures = home.path().join("Imágenes");
    std::fs::write(
        config.path().join("user-dirs.dirs"),
        format!("XDG_PICTURES_DIR=\"{}\"\n", pictures.display()),
    )
    .unwrap();
    // SAFETY: único test de este binario que modifica el entorno.
    unsafe {
        std::env::set_var("HOME", home.path());
        std::env::set_var("XDG_CONFIG_HOME", config.path());
        std::env::set_var("XDG_PICTURES_DIR", &pictures);
    }

    // 1) Resolver no crea nada.
    let esperado = pictures.join("Knivchit");
    assert_eq!(resolve_save_dir(SAVE_DIR_PLACEHOLDER), Ok(esperado.clone()));
    assert!(!esperado.exists(), "resolver no debe crear la carpeta");
    assert!(!pictures.exists());
    assert!(
        home.file_names().is_empty(),
        "HOME sigue vacío: {:?}",
        home.file_names()
    );

    // 2) Las variantes siguen siendo error y tampoco crean nada.
    for raw in ["__placeholder__", "__PLACEHOLDER__/x", "   ", "rel"] {
        assert!(resolve_save_dir(raw).is_err(), "{raw}");
    }
    assert!(home.file_names().is_empty());

    // 3) Guardar con el placeholder crea la carpeta y escribe ahí el PNG.
    let app = mock_builder()
        .manage(CaptureState(Mutex::new(Some(PathBuf::from("/tmp/p.png")))))
        .manage(memory_pool())
        .invoke_handler(tauri::generate_handler![
            knivchit_lib::commands::output::save_capture
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    let guardado = save_via_ipc(&webview, SAVE_DIR_PLACEHOLDER).expect("debe guardar");
    assert!(
        guardado.starts_with(esperado.to_str().unwrap()),
        "se guardó fuera de la carpeta por defecto: {guardado}"
    );
    assert_eq!(png_size_on_disk(guardado.as_ref()), (4, 4));
    assert!(
        guardado.starts_with(home.path().to_str().unwrap()),
        "no debe tocar el HOME real"
    );
}
