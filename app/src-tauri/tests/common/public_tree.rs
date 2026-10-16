//! Qué archivos del repositorio NO se publican y cómo reconocer una referencia
//! a ellos. Compartido por `public_tree_guard.rs` y `rename_guard.rs`
//! (`#[path = "common/public_tree.rs"] mod public_tree;`).
//!
//! Los literales se construyen en ejecución (piezas unidas) para que estos
//! archivos, que sí se publican, no se detecten a sí mismos ni nombren las
//! rutas internas.

#![allow(dead_code)]

use std::path::PathBuf;
use std::process::Command;

fn j(parts: &[&str]) -> String {
    parts.concat()
}

/// Rutas exactas o prefijos (terminados en `/` o en `-`) que no se publican.
pub fn non_public_prefixes() -> Vec<String> {
    vec![
        j(&[".cla", "ude/"]),
        j(&["docs/", "segur", "idad/"]),
        j(&["docs/", "super", "powers/"]),
        j(&["docs/", "investig", "acion-"]),
        j(&["docs/", "inform", "e-"]),
        j(&["docs/", "verific", "acion-"]),
        j(&["tools/", "arnes-", "shell/"]),
        j(&["landing/", "lab/"]),
    ]
}

pub fn non_public_exact() -> Vec<String> {
    vec![
        j(&["docs/", "extensions-", "gnome-org.md"]),
        j(&["docs/", "rebran", "ding.md"]),
        j(&["landing/", "VERIFI", "CACION.md"]),
    ]
}

/// Nombres de archivo que no se publican en ningún directorio.
pub fn non_public_names() -> Vec<String> {
    vec![j(&["CLA", "UDE.md"]), j(&["AGE", "NTS.md"])]
}

pub fn is_non_public(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    non_public_exact().iter().any(|e| e == path)
        || non_public_names().iter().any(|n| n == name)
        || non_public_prefixes()
            .iter()
            .any(|p| path.starts_with(p.as_str()))
}

/// Fragmentos que delatan una referencia a una ruta no publicable.
pub fn reference_needles() -> Vec<String> {
    vec![
        j(&["CLA", "UDE.md"]),
        j(&["AGE", "NTS.md"]),
        j(&[".cla", "ude/"]),
        j(&["docs/", "segur", "idad"]),
        j(&["docs/", "super", "powers"]),
        j(&["docs/", "investig", "acion"]),
        j(&["docs/", "inform", "e"]),
        j(&["docs/", "verific", "acion"]),
        j(&["docs/", "extensions-", "gnome-org"]),
        j(&["docs/", "rebran", "ding"]),
        j(&["tools/", "arnes-", "shell"]),
        j(&["landing/", "lab"]),
        j(&["VERIFI", "CACION"]),
        j(&["blue", "print.md"]),
    ]
}

/// Raíz del árbol a revisar: por defecto este repositorio; con la variable
/// `PUBLIC_TREE_ROOT` se revisa otro árbol (p. ej. el exportado para publicar)
/// sin copiar ni tocar nada en él.
fn repo_root() -> PathBuf {
    match std::env::var_os("PUBLIC_TREE_ROOT") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."),
    }
}

/// Archivos versionados (`git ls-files`), rutas desde la raíz del repo.
pub fn tracked_files() -> Vec<String> {
    let out = Command::new("git")
        .args(["ls-files", "-z", "--full-name", "--", ":/"])
        .current_dir(repo_root())
        .output()
        .expect("git no está disponible: este test necesita `git ls-files`");
    assert!(out.status.success(), "git ls-files falló");
    String::from_utf8(out.stdout)
        .expect("rutas no UTF-8")
        .split('\0')
        .filter(|p| !p.is_empty())
        .map(String::from)
        .collect()
}

/// Lo que quedaría en el árbol público: los versionados menos los no publicables.
pub fn public_files() -> Vec<String> {
    tracked_files()
        .into_iter()
        .filter(|p| !is_non_public(p))
        .collect()
}

/// Texto de un archivo del repo, o `None` si es binario o no existe.
pub fn read_text(path: &str) -> Option<String> {
    std::fs::read(repo_root().join(path))
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
}
