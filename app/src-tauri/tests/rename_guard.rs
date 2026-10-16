//! Guarda del renombrado al nombre actual: el nombre anterior del producto solo
//! puede aparecer en la migración de datos y en la lectura de preferencias
//! antiguas (lista cerrada de abajo). En cualquier otro archivo del producto
//! es un resto del renombrado (un identificador, un título de ventana, un
//! texto de la landing…).
//!
//! La guarda mira solo el ÁRBOL PUBLICABLE, descrito en positivo
//! (`PUBLISHED`): así da el mismo resultado en el repositorio completo y en el
//! publicado. El nombre viejo se arma en ejecución para que este archivo no
//! lo contenga.

use std::process::Command;

/// Nombre anterior del producto, armado en ejecución.
fn old_name() -> String {
    ["view", "clip"].concat()
}

/// Rutas (o prefijos terminados en `/`) del producto publicado que se vigilan.
const PUBLISHED: [&str; 24] = [
    "app/",
    "extension/",
    ".github/",
    "landing/src/",
    "landing/scripts/",
    "landing/site/",
    "landing/README.md",
    "landing/vercel.json",
    "landing/wrangler.toml",
    "docs/arquitectura.md",
    "docs/ramas.md",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "LICENSE",
    "install.sh",
    "install.test.sh",
    ".gitignore",
    // por si el árbol publicable no trae alguno de los anteriores, git lo ignora
    "package.json",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "Cargo.toml",
    "Cargo.lock",
];

/// Lista CERRADA de archivos del producto donde el nombre anterior es
/// deliberado: la migración de datos y la lectura de preferencias antiguas.
const ALLOWED: [&str; 6] = [
    "app/index.html",
    "app/src-tauri/src/legacy_migration.rs",
    "app/src/lib/theme.ts",
    "app/src/lib/theme.test.ts",
    "install.sh",
    "install.test.sh",
];

fn leftovers(paths: &[&str]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| !ALLOWED.contains(p))
        .map(|p| p.to_string())
        .collect()
}

fn git(args: &[&str]) -> Vec<String> {
    let out = Command::new("git")
        .args(args)
        .arg("--")
        .args(PUBLISHED)
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("git no está disponible: este test necesita `git`");
    // código 1 = sin coincidencias (git grep); otro distinto de 0 es un fallo real
    assert!(out.status.success() || out.status.code() == Some(1), "git falló");
    String::from_utf8(out.stdout)
        .expect("rutas no UTF-8")
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect()
}

#[test]
fn the_guard_knows_allowed_and_forbidden_places() {
    assert!(leftovers(&["install.sh", "app/src/lib/theme.ts"]).is_empty());
    for bad in [
        "landing/src/strings/es.json",
        "extension/metadata.json",
        "app/src-tauri/tauri.conf.json",
        "README.md",
        "app/src-tauri/src/lib.rs",
    ] {
        assert_eq!(leftovers(&[bad]), vec![bad.to_string()], "{bad}");
    }
}

#[test]
fn no_published_file_name_or_content_keeps_the_old_name_outside_the_migration() {
    let old = old_name();
    let files = git(&["grep", "--full-name", "-l", "-i", "-I", "-z", &old]);
    let files: Vec<&str> = files.iter().map(String::as_str).collect();
    assert_eq!(
        leftovers(&files),
        Vec::<String>::new(),
        "el nombre anterior aparece fuera de los archivos permitidos"
    );

    let by_name: Vec<String> = git(&["ls-files", "-z", "--full-name"])
        .into_iter()
        .filter(|p| p.to_lowercase().contains(&old))
        .collect();
    assert_eq!(by_name, Vec::<String>::new(), "rutas con el nombre anterior");
}
