//! Higiene del repositorio: falla si en `git ls-files` se cuela una ruta con
//! un componente vacío o solo espacios, un binario/empaquetado o una imagen
//! fuera de los sitios donde es deliberada (iconos, capturas de la landing,
//! fixtures de tests). Origen: un PNG escrito por una versión antigua de
//! `save_capture` en `app/src-tauri/   /` se coló en un commit.

use std::process::Command;

const IMAGE_EXT: [&str; 5] = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const FORBIDDEN_EXT: [&str; 11] = [
    ".appimage",
    ".zip",
    ".tar",
    ".tgz",
    ".gz",
    ".deb",
    ".rpm",
    ".exe",
    ".dll",
    ".so",
    ".dmg",
];

fn image_is_allowed(path: &str) -> bool {
    path.starts_with("landing/capturas/")
        || path.starts_with("landing/site/")
        || path.starts_with("app/src-tauri/icons/")
        || path.split('/').any(|c| c == "fixtures" || c == "fixture")
}

/// Tope por imagen bajo `landing/site/`: el sitio entero pesa ~260 KB y la
/// mayor (og.jpg) ~47 KB; 150 KB deja holgura y frena una captura sin optimizar.
const SITE_IMAGE_MAX_BYTES: u64 = 150_000;

fn oversized_site_images(files: &[(&str, u64)]) -> Vec<String> {
    files
        .iter()
        .filter(|(p, size)| {
            let lower = p.to_lowercase();
            p.starts_with("landing/site/")
                && IMAGE_EXT.iter().any(|e| lower.ends_with(e))
                && *size > SITE_IMAGE_MAX_BYTES
        })
        .map(|(p, size)| {
            format!("imagen de landing/site/ pesa {size} B (tope {SITE_IMAGE_MAX_BYTES}): {p}")
        })
        .collect()
}

fn hygiene_problems(paths: &[&str]) -> Vec<String> {
    let mut problems = Vec::new();
    for p in paths {
        let lower = p.to_lowercase();
        if p.split('/').any(|c| c.trim().is_empty()) {
            problems.push(format!(
                "ruta con un componente vacío o solo espacios: {p:?}"
            ));
        }
        if FORBIDDEN_EXT.iter().any(|e| lower.ends_with(e)) {
            problems.push(format!("binario o empaquetado versionado: {p}"));
        }
        if IMAGE_EXT.iter().any(|e| lower.ends_with(e)) && !image_is_allowed(p) {
            problems.push(format!(
                "imagen fuera de iconos, landing/capturas, landing/site o fixtures: {p}"
            ));
        }
    }
    problems
}

#[test]
fn the_detector_flags_the_known_bad_cases() {
    for bad in [
        "app/src-tauri/   /knivchit-20261013-211151.png",
        "a/ /b.txt",
        "dist/Knivchit.AppImage",
        "release/build.zip",
        "app/src-tauri/captura.png",
        "app/src/foto.jpg",
    ] {
        assert!(!hygiene_problems(&[bad]).is_empty(), "{bad}");
    }
}

#[test]
fn the_detector_accepts_deliberate_images() {
    assert!(hygiene_problems(&[
        "landing/capturas/hub-01-inicio.png",
        "landing/site/assets/img/og.jpg",
        "app/src-tauri/icons/icon.png",
        "app/src-tauri/tests/fixtures/pequena.png",
        "app/src/App.tsx",
    ])
    .is_empty());
}

#[test]
fn nothing_tracked_by_git_is_an_empty_path_a_binary_or_a_stray_image() {
    let out = Command::new("git")
        .args(["ls-files", "-z", "--full-name", "--", ":/"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("git no está disponible: este test necesita `git ls-files`");
    assert!(out.status.success(), "git ls-files falló");
    let listing = String::from_utf8(out.stdout).expect("rutas no UTF-8 en git ls-files");
    let paths: Vec<&str> = listing.split('\0').filter(|p| !p.is_empty()).collect();
    assert!(!paths.is_empty(), "git ls-files no devolvió nada");
    assert_eq!(hygiene_problems(&paths), Vec::<String>::new());
}

#[test]
fn the_size_cap_flags_only_heavy_images_in_the_site() {
    assert!(oversized_site_images(&[("landing/site/assets/img/og.jpg", 46_759)]).is_empty());
    assert!(
        !oversized_site_images(&[("landing/site/assets/img/captura.png", 2_000_000)]).is_empty()
    );
    // fuera de landing/site/ el tope no aplica (lo gobierna la lista de rutas permitidas)
    assert!(oversized_site_images(&[("landing/capturas/hub.png", 2_000_000)]).is_empty());
}

#[test]
fn images_in_the_site_respect_the_size_cap() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = Command::new("git")
        .args(["ls-files", "-z", "--full-name", "--", ":/landing/site"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("git no está disponible: este test necesita `git ls-files`");
    assert!(out.status.success(), "git ls-files falló");
    let listing = String::from_utf8(out.stdout).expect("rutas no UTF-8 en git ls-files");
    let files: Vec<(String, u64)> = listing
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(|p| {
            (
                p.to_string(),
                std::fs::metadata(root.join(p))
                    .map(|m| m.len())
                    .unwrap_or(0),
            )
        })
        .collect();
    let refs: Vec<(&str, u64)> = files.iter().map(|(p, s)| (p.as_str(), *s)).collect();
    assert_eq!(oversized_site_images(&refs), Vec::<String>::new());
}
