//! Texto de marca del sitio publicado: decisión de producto (2026-10-16) de
//! quitar la pronunciación («Pronounced KNIV-chit», «KNIV-chit.» y el aviso
//! `pron-note`) de la landing. El sitio (`landing/site`) y sus fuentes
//! (`landing/src`) no deben volver a contenerla.

use std::path::{Path, PathBuf};

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn text_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            text_files(&p, out);
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| {
            [
                "html",
                "json",
                "xml",
                "txt",
                "js",
                "mjs",
                "css",
                "svg",
                "md",
                "webmanifest",
            ]
            .contains(&x)
        }) {
            out.push(p);
        }
    }
}

const FORBIDDEN: [&str; 3] = ["pronunc", "kniv-chit", "pron-note"];

fn offenders(files: &[(String, String)]) -> Vec<String> {
    let mut out = Vec::new();
    for (name, text) in files {
        let lower = text.to_lowercase();
        for needle in FORBIDDEN {
            if lower.contains(needle) {
                out.push(format!("{name}: «{needle}»"));
            }
        }
    }
    out
}

#[test]
fn the_detector_flags_pronunciation_copy() {
    let bad = |t: &str| vec![("x.html".to_string(), t.to_string())];
    assert!(!offenders(&bad("<p>Pronounced KNIV-chit.</p>")).is_empty());
    assert!(!offenders(&bad("La pronunciación es…")).is_empty());
    assert!(!offenders(&bad("<p class=\"pron-note\">")).is_empty());
    assert!(offenders(&bad("<h1>Knivchit</h1> Kniv means knife")).is_empty());
}

#[test]
fn the_published_site_and_its_sources_do_not_mention_pronunciation() {
    let mut paths = Vec::new();
    text_files(&repo().join("landing/site"), &mut paths);
    text_files(&repo().join("landing/src"), &mut paths);
    assert!(
        !paths.is_empty(),
        "no se encontró landing/site ni landing/src"
    );
    let files: Vec<(String, String)> = paths
        .iter()
        .map(|p| {
            (
                p.strip_prefix(repo()).unwrap_or(p).display().to_string(),
                std::fs::read_to_string(p).unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(offenders(&files), Vec::<String>::new());
}
