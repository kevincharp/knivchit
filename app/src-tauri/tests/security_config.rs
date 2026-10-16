//! Invariantes de `tauri.conf.json` que no deben retroceder en silencio.
//! `csp` es la política de release; `devCsp` solo la usa `tauri dev`
//! (tauri-codegen elige una u otra según `dev`), así que la laxitud de la
//! segunda no llega a un binario de release.

fn config() -> serde_json::Value {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn directive(csp: &str, name: &str) -> String {
    csp.split(';')
        .map(str::trim)
        .find(|d| d.split_whitespace().next() == Some(name))
        .unwrap_or_else(|| panic!("la CSP no define {name}"))
        .to_string()
}

#[test]
fn release_csp_is_strict() {
    let cfg = config();
    let csp = cfg["app"]["security"]["csp"].as_str().expect("csp definida (no null)");
    assert_eq!(directive(csp, "default-src"), "default-src 'self'");
    let script = directive(csp, "script-src");
    assert!(!script.contains("unsafe-inline") && !script.contains("unsafe-eval"), "{script}");
    for d in ["connect-src", "object-src", "base-uri", "frame-ancestors"] {
        directive(csp, d);
    }
    assert!(!csp.contains("localhost:1420") && !csp.contains("ws:"), "{csp}");
    assert!(!csp.contains("http: ") && !csp.contains("https: ") && !csp.contains(" *"), "{csp}");
}

#[test]
fn the_dev_server_is_only_mentioned_by_dev_csp() {
    let cfg = config();
    let dev = cfg["app"]["security"]["devCsp"].as_str().unwrap();
    assert!(dev.contains("localhost:1420"));
    assert_eq!(cfg["build"]["devUrl"], "http://localhost:1420");
}

// «main» es la ventana con más permisos. Si Tauri la creara sola desde la
// configuración nacería SIN el filtro de navegación; con `create: false` solo
// la construye `show_main_window`, que sí se lo aplica.
#[test]
fn the_main_window_is_built_by_show_main_window_with_its_navigation_filter() {
    let cfg = config();
    let main = cfg["app"]["windows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["label"] == "main")
        .expect("la configuración declara la ventana main");
    assert_eq!(main["create"], false, "main no debe crearla Tauri sola");

    let lib = std::fs::read_to_string(
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs"),
    )
    .unwrap();
    let builder = &lib[lib.find("from_config(app, &config)").unwrap()..];
    assert!(
        builder[..builder.find(".build()").unwrap()].contains("on_navigation(navigation::allow_navigation)"),
        "show_main_window debe aplicar el filtro de navegación"
    );
}
