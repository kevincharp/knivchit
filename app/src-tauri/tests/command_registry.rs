//! Cada comando Tauri debe estar registrado en `generate_handler!` (regla del
//! proyecto: «cada uno registrado explícitamente») y todo `invoke("…")` de
//! `lib/tauri.ts` debe apuntar a un comando registrado. Un comando escrito
//! pero sin registrar compila, pasa los tests de su lógica y falla en
//! ejecución con «command not found».

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Nombre de cada `fn` que sigue a un `#[tauri::command]`.
fn declared_commands() -> BTreeSet<String> {
    let mut files = Vec::new();
    rust_files(&manifest().join("src"), &mut files);
    let mut names = BTreeSet::new();
    for file in files {
        let text = std::fs::read_to_string(&file).unwrap();
        let mut pending = false;
        for line in text.lines().map(str::trim) {
            if line.starts_with("#[tauri::command") {
                pending = true;
            } else if pending && line.starts_with("#[") {
                continue;
            } else if pending {
                let rest = line
                    .trim_start_matches("pub(crate) ")
                    .trim_start_matches("pub ")
                    .trim_start_matches("async ");
                if let Some(sig) = rest.strip_prefix("fn ") {
                    let name: String = sig
                        .chars()
                        .take_while(|c| c.is_alphanumeric() || *c == '_')
                        .collect();
                    names.insert(name);
                }
                pending = false;
            }
        }
    }
    names
}

/// Último segmento de cada ruta dentro de `generate_handler![ … ]`.
fn registered_commands() -> BTreeSet<String> {
    let lib = std::fs::read_to_string(manifest().join("src/lib.rs")).unwrap();
    let start = lib
        .find("generate_handler![")
        .expect("lib.rs no tiene generate_handler!")
        + "generate_handler![".len();
    let end = start + lib[start..].find(']').unwrap();
    lib[start..end]
        .split(',')
        .map(|item| item.trim().rsplit("::").next().unwrap_or("").to_string())
        .filter(|n| !n.is_empty())
        .collect()
}

/// Nombres pasados a `invoke<…>("nombre"` en `lib/tauri.ts`.
fn invoked_by_the_frontend() -> BTreeSet<String> {
    let ts = std::fs::read_to_string(manifest().join("../src/lib/tauri.ts")).unwrap();
    let mut names = BTreeSet::new();
    let mut rest = ts.as_str();
    while let Some(i) = rest.find("invoke") {
        rest = &rest[i + "invoke".len()..];
        let Some(open) = rest.find('(') else { break };
        let after = rest[open + 1..].trim_start();
        if let Some(quoted) = after.strip_prefix('"') {
            if let Some(end) = quoted.find('"') {
                names.insert(quoted[..end].to_string());
            }
        }
    }
    names
}

#[test]
fn every_tauri_command_is_registered_in_the_handler() {
    let missing: Vec<_> = declared_commands()
        .difference(&registered_commands())
        .cloned()
        .collect();
    assert!(
        missing.is_empty(),
        "comandos con #[tauri::command] sin registrar en generate_handler!: {missing:?}"
    );
}

#[test]
fn every_invoke_in_the_frontend_targets_a_registered_command() {
    let invoked = invoked_by_the_frontend();
    assert!(!invoked.is_empty(), "no se encontró ningún invoke en lib/tauri.ts");
    let unknown: Vec<_> = invoked
        .difference(&registered_commands())
        .cloned()
        .collect();
    assert!(
        unknown.is_empty(),
        "lib/tauri.ts invoca comandos que no están registrados: {unknown:?}"
    );
}

#[test]
fn the_scanners_see_a_known_command() {
    assert!(declared_commands().contains("save_capture"));
    assert!(registered_commands().contains("save_capture"));
    assert!(invoked_by_the_frontend().contains("get_capture_preview"));
}

/// Comandos listados en `APP_COMMANDS` de `build.rs` (el `AppManifest`).
fn manifest_commands() -> BTreeSet<String> {
    let build = std::fs::read_to_string(manifest().join("build.rs")).unwrap();
    let start = build.find("APP_COMMANDS: &[&str] = &[").unwrap();
    let body = &build[start..];
    let body = &body[..body.find("];").unwrap()];
    body.split('"').skip(1).step_by(2).map(str::to_string).collect()
}

/// Permisos `allow-…` concedidos por todas las capabilities.
fn granted_permissions() -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for entry in std::fs::read_dir(manifest().join("capabilities")).unwrap() {
        let path = entry.unwrap().path();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        for p in json["permissions"].as_array().unwrap() {
            out.insert(p.as_str().unwrap().to_string());
        }
    }
    out
}

#[test]
fn the_app_manifest_lists_exactly_the_registered_commands() {
    assert_eq!(manifest_commands(), registered_commands());
}

// Un comando que ninguna capability concede es inalcanzable desde el webview
// (falla en ejecución con «not allowed»), salvo los reservados del historial.
#[test]
fn every_frontend_command_is_granted_to_some_window() {
    let granted = granted_permissions();
    for cmd in invoked_by_the_frontend() {
        let perm = format!("allow-{}", cmd.replace('_', "-"));
        let reserved = cmd.ends_with("clipboard_history") || cmd.ends_with("clipboard_entry");
        assert!(
            granted.contains(&perm) || reserved,
            "ninguna capability concede {perm}: la ventana no podría invocar {cmd}"
        );
    }
}

fn capability(name: &str) -> BTreeSet<String> {
    let path = manifest().join("capabilities").join(format!("{name}.json"));
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    json["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect()
}

// Ninguna ventana recibe un conjunto `*:default` de core ni comodines: cada
// permiso de core se concede a mano, por ventana.
#[test]
fn no_capability_grants_a_core_default_set_or_wildcard() {
    for name in ["default", "capture-overlay", "pin"] {
        for perm in capability(name) {
            assert!(!perm.ends_with(":default"), "{name}: {perm}");
            assert!(!perm.contains('*'), "{name}: {perm}");
        }
    }
}

// Lo que el frontend usa de core en cada ventana (lib/tauri.ts, TitleBar,
// CaptureOverlay, PinWindow, data-tauri-drag-region). Si un componente nuevo
// llama a otra API de ventana, este test y la capability se actualizan juntos.
#[test]
fn each_window_has_exactly_the_core_permissions_it_uses() {
    let core = |name: &str| -> BTreeSet<String> {
        capability(name).into_iter().filter(|p| p.starts_with("core:")).collect()
    };
    let set = |v: &[&str]| -> BTreeSet<String> { v.iter().map(|s| s.to_string()).collect() };
    assert_eq!(
        core("default"),
        set(&[
            "core:app:allow-version",
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-close",
            "core:window:allow-minimize",
            "core:window:allow-start-dragging",
        ])
    );
    assert_eq!(
        core("capture-overlay"),
        set(&[
            "core:window:allow-close",
            "core:window:allow-show",
            "core:window:allow-hide",
            "core:window:allow-set-focus",
            "core:webview:allow-set-webview-focus",
        ])
    );
    assert_eq!(
        core("pin"),
        set(&[
            "core:window:allow-close",
            "core:window:allow-start-dragging",
            "core:window:allow-set-focus",
        ])
    );
}
