//! Contrato del icono de la barra superior, «Salir de Knivchit» y la bandeja
//! nativa retirada: (1) los comandos nuevos solo los puede invocar la ventana
//! `main`; (2) `ShowMain` y `StartCapture` solo se autorizan a quien toca;
//! (3) no queda rastro de la bandeja nativa (tray-icon / libappindicator) ni
//! en el grafo de dependencias, ni en el código, ni en CI/release.

use knivchit_lib::dbus::{
    CallerTrust, Callers, PeerInfo, SHOW_MAIN_CALLERS, START_CAPTURE_CALLERS,
};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}
fn repo() -> PathBuf {
    manifest().join("../..")
}

fn read_capability(name: &str) -> serde_json::Value {
    let path = manifest().join("capabilities").join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}
fn permissions(name: &str) -> BTreeSet<String> {
    read_capability(name)["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p.as_str().unwrap().to_string())
        .collect()
}

// ---- 1. capabilities --------------------------------------------------------

const MAIN_ONLY: [&str; 3] = [
    "allow-quit-app",
    "allow-get-panel-icon",
    "allow-set-panel-icon",
];

#[test]
fn quit_and_panel_icon_commands_are_granted_to_the_main_window_only() {
    assert_eq!(
        read_capability("default")["windows"],
        serde_json::json!(["main"])
    );
    for perm in MAIN_ONLY {
        assert!(
            permissions("default").contains(perm),
            "main no tiene {perm}"
        );
        for other in ["capture-overlay", "pin"] {
            assert!(
                !permissions(other).contains(perm),
                "{other} no debe tener {perm}"
            );
        }
    }
}

#[test]
fn there_is_no_capability_file_beyond_the_three_known_ones() {
    // una capability nueva podría conceder los comandos a otra ventana sin que los tests la vean
    let mut names: Vec<String> = std::fs::read_dir(manifest().join("capabilities"))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".json"))
        .collect();
    names.sort();
    assert_eq!(names, ["capture-overlay.json", "default.json", "pin.json"]);
}

#[test]
fn only_main_owns_windows_that_are_not_overlay_or_pins() {
    assert_eq!(
        read_capability("capture-overlay")["windows"],
        serde_json::json!(["capture-overlay"])
    );
    assert_eq!(
        read_capability("pin")["windows"],
        serde_json::json!(["pin-*"])
    );
}

// ---- 2. autorización de ShowMain / StartCapture ------------------------------

fn peer(uid: Option<u32>, exe: Option<&str>) -> PeerInfo {
    PeerInfo {
        uid,
        exe_name: exe.map(String::from),
        // el caso por defecto: el ejecutable es de root (lo que exige gnome-shell)
        exe_root_owned: true,
    }
}
fn trust() -> CallerTrust {
    CallerTrust::Enforced {
        my_uid: 1000,
        my_exe_name: "knivchit".into(),
    }
}

#[test]
fn show_main_is_allowed_to_gnome_shell_and_to_another_knivchit_of_the_same_user() {
    assert!(trust().allows(&peer(Some(1000), Some("gnome-shell")), SHOW_MAIN_CALLERS));
    assert!(trust().allows(&peer(Some(1000), Some("knivchit")), SHOW_MAIN_CALLERS));
}

#[test]
fn show_main_is_denied_to_strangers() {
    for (case, p) in [
        (
            "otro usuario con gnome-shell",
            peer(Some(1001), Some("gnome-shell")),
        ),
        (
            "otro usuario con knivchit",
            peer(Some(1001), Some("knivchit")),
        ),
        ("ejecutable ajeno", peer(Some(1000), Some("bash"))),
        ("python", peer(Some(1000), Some("python3"))),
        ("sin ejecutable comprobable", peer(Some(1000), None)),
        ("sin uid", peer(None, Some("gnome-shell"))),
        ("sin nada", peer(None, None)),
        ("nombre parecido", peer(Some(1000), Some("gnome-shell-x"))),
        (
            "nombre con ruta",
            peer(Some(1000), Some("/usr/bin/gnome-shell")),
        ),
    ] {
        assert!(!trust().allows(&p, SHOW_MAIN_CALLERS), "{case}");
    }
}

#[test]
fn start_capture_is_only_for_gnome_shell_not_for_knivchit() {
    assert!(trust().allows(
        &peer(Some(1000), Some("gnome-shell")),
        START_CAPTURE_CALLERS
    ));
    assert!(!trust().allows(&peer(Some(1000), Some("knivchit")), START_CAPTURE_CALLERS));
    assert!(!trust().allows(&peer(Some(1000), Some("bash")), START_CAPTURE_CALLERS));
}

#[test]
fn an_empty_own_binary_name_never_matches_an_empty_peer_name() {
    let t = CallerTrust::Enforced {
        my_uid: 1000,
        my_exe_name: String::new(),
    };
    assert!(!t.allows(&peer(Some(1000), Some("")), SHOW_MAIN_CALLERS));
    assert!(!t.allows(&peer(Some(1000), Some("knivchit")), SHOW_MAIN_CALLERS));
    // gnome-shell sigue pudiendo
    assert!(t.allows(&peer(Some(1000), Some("gnome-shell")), SHOW_MAIN_CALLERS));
}

#[test]
fn nobody_is_allowed_by_an_empty_callers_set() {
    let none = Callers {
        shell: false,
        own_binary: false,
    };
    assert!(!trust().allows(&peer(Some(1000), Some("gnome-shell")), none));
    assert!(!trust().allows(&peer(Some(1000), Some("knivchit")), none));
}

// ---- 3. bandeja nativa retirada ----------------------------------------------

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            rust_files(&p, out);
        } else if p.extension().is_some_and(|x| x == "rs") {
            out.push(p);
        }
    }
}

#[test]
fn the_tauri_dependency_does_not_enable_the_tray_icon_feature() {
    let toml = std::fs::read_to_string(manifest().join("Cargo.toml")).unwrap();
    assert!(!toml.contains("tray-icon"), "Cargo.toml aún pide tray-icon");
    assert!(
        !toml.contains("appindicator"),
        "Cargo.toml aún pide appindicator"
    );
}

#[test]
fn the_dependency_graph_has_no_tray_icon_nor_libappindicator() {
    // Cargo.lock lista las dependencias opcionales de cualquier feature; lo que cuenta es el grafo real.
    let cargo = std::env::var("CARGO").unwrap_or_else(|_| "cargo".into());
    for krate in ["tray-icon", "libappindicator", "libappindicator-sys"] {
        let out = Command::new(&cargo)
            .args([
                "tree",
                "--offline",
                "--target",
                "all",
                "-e",
                "normal,build,dev",
                "-i",
                krate,
            ])
            .arg("--manifest-path")
            .arg(manifest().join("Cargo.toml"))
            .output()
            .expect("cargo tree");
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            !stdout.contains(&format!("{krate} v")),
            "{krate} está en el grafo:\n{stdout}"
        );
    }
}

#[test]
fn the_source_and_the_config_do_not_build_a_native_tray() {
    let mut files = Vec::new();
    rust_files(&manifest().join("src"), &mut files);
    for f in files {
        let text = std::fs::read_to_string(&f).unwrap();
        for needle in ["TrayIconBuilder", "tray_icon", "tauri::tray", ".tray_icon("] {
            assert!(!text.contains(needle), "{} usa {needle}", f.display());
        }
    }
    let conf = std::fs::read_to_string(manifest().join("tauri.conf.json")).unwrap();
    assert!(
        !conf.contains("trayIcon"),
        "tauri.conf.json configura trayIcon"
    );
}

#[test]
fn ci_and_release_do_not_install_appindicator_libraries() {
    let dir = repo().join(".github/workflows");
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let text = std::fs::read_to_string(e.path()).unwrap().to_lowercase();
        for needle in ["appindicator", "ayatana"] {
            assert!(
                !text.contains(needle),
                "{} instala {needle}",
                e.path().display()
            );
        }
    }
}
