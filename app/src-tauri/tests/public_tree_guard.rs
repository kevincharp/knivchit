//! Guarda del árbol público. El primer push publica solo una parte del
//! repositorio; esta guarda se ejecuta sobre los archivos versionados MENOS los
//! no publicables (ver `common/public_tree.rs`) y comprueba que:
//!
//! 1. ningún archivo público menciona una ruta no publicable (enlaces rotos,
//!    referencias a documentos internos);
//! 2. ningún test o script público LEE un archivo no publicable (el test
//!    pasaría aquí y fallaría en el árbol publicado);
//! 3. el propio árbol público no depende de que existan los excluidos: las
//!    comprobaciones solo miran archivos públicos.
//!
//! Debe pasar tanto en el árbol completo como en el publicable.

#[path = "common/public_tree.rs"]
mod public_tree;

use public_tree::{is_non_public, public_files, read_text, reference_needles};

/// Referencias a rutas no publicables en el texto: `(línea, fragmento)`.
fn references_in(text: &str) -> Vec<(usize, String)> {
    let needles = reference_needles();
    let mut out = Vec::new();
    for (i, line) in text.lines().enumerate() {
        for n in &needles {
            if line.contains(n.as_str()) {
                out.push((i + 1, n.clone()));
            }
        }
    }
    out
}

/// `.gitignore` puede ignorar los directorios locales de los agentes y de la
/// carpeta de diseño: ignorar una ruta no la documenta ni enlaza. Se exime
/// SOLO una línea que es exactamente una de esas entradas de ignorado
/// (el directorio de agentes con o sin barra final, el archivo local de
/// instrucciones y la carpeta de diseño escrita con clase de caracteres);
/// cualquier otra mención en `.gitignore` sigue contando.
fn exempt_gitignore_line(path: &str, text: &str, line_no: usize) -> bool {
    if path != ".gitignore" {
        return false;
    }
    let line = text.lines().nth(line_no - 1).unwrap_or("").trim();
    let dir = [".cla", "ude"].concat();
    let local = ["CLA", "UDE.local.md"].concat();
    let design = ["/[b]lue", "prints/"].concat();
    [
        dir.clone(),
        format!("{dir}/"),
        format!("/{dir}/"),
        local,
        design,
    ]
    .iter()
    .any(|e| e == line)
}

// ---- 1. referencias -----------------------------------------------------------

#[test]
fn the_detector_recognizes_references_and_the_exclusion_list() {
    let doc = ["ver ", "docs/", "rebran", "ding.md para más"].concat();
    assert_eq!(references_in(&doc).len(), 1);
    assert!(references_in("nada que ver aquí con docs/arquitectura.md").is_empty());
    assert!(is_non_public(
        &["docs/", "super", "powers/specs/x.md"].concat()
    ));
    assert!(is_non_public(&["a/b/CLA", "UDE.md"].concat()));
    assert!(is_non_public(&["tools/", "arnes-", "shell/x.sh"].concat()));
    assert!(!is_non_public("docs/arquitectura.md"));
    assert!(!is_non_public("docs/ramas.md"));
    assert!(!is_non_public("README.md"));
}

#[test]
fn no_public_file_references_a_non_public_path() {
    let mut offenders = Vec::new();
    for path in public_files() {
        let Some(text) = read_text(&path) else {
            continue;
        };
        for (line, needle) in references_in(&text) {
            if exempt_gitignore_line(&path, &text, line) {
                continue;
            }
            offenders.push(format!("{path}:{line}: {needle}"));
        }
    }
    assert!(
        offenders.is_empty(),
        "{} referencia(s) a rutas no publicables desde archivos públicos:\n{}",
        offenders.len(),
        offenders.join("\n")
    );
}

#[test]
fn only_exact_ignore_entries_are_exempt_in_gitignore() {
    let dir = [".cla", "ude"].concat();
    let ok = format!("target/\n{dir}\n{dir}/\nCLA{}\n", "UDE.local.md");
    for n in 2..=4 {
        assert!(exempt_gitignore_line(".gitignore", &ok, n), "línea {n}");
    }
    assert!(!exempt_gitignore_line(".gitignore", &ok, 1));
    // una mención de verdad en .gitignore (comentario con enlace) no se exime
    let doc = format!("# ver {dir}/rules/x.md\n");
    assert!(!exempt_gitignore_line(".gitignore", &doc, 1));
    // y otros archivos nunca
    assert!(!exempt_gitignore_line("README.md", &dir, 1));
}

// ---- 2. lecturas ----------------------------------------------------------------

const READ_CALLS: [&str; 10] = [
    "read_to_string",
    "fs::read",
    "readFileSync",
    "include_str!",
    "include_bytes!",
    "File::open",
    "read_dir",
    "readdirSync",
    "readFile(",
    "open(",
];

/// Palabras sueltas que, junto a una lectura, delatan un archivo no publicable
/// aunque la ruta esté partida en trozos (`join("x").join("y")`).
fn tell_tale_words() -> Vec<String> {
    vec![
        ["super", "powers"].concat(),
        ["segur", "idad"].concat(),
        ["rebran", "ding"].concat(),
        ["arnes-", "shell"].concat(),
        ["investig", "acion-"].concat(),
        ["inform", "e-"].concat(),
        ["verific", "acion-"].concat(),
        ["extensions-", "gnome-org"].concat(),
        ["VERIFI", "CACION"].concat(),
        ["CLA", "UDE"].concat(),
        ["AGE", "NTS"].concat(),
        [".cla", "ude"].concat(),
        ["\"", "lab", "\""].concat(),
        ["/", "lab", "/"].concat(),
    ]
}

/// Lecturas sospechosas: una llamada de lectura con una palabra delatora en la
/// misma línea o en las tres siguientes (rutas partidas en varias líneas).
fn reads_of_non_public(text: &str) -> Vec<(usize, String)> {
    let words = tell_tale_words();
    let lines: Vec<&str> = text.lines().collect();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        if !READ_CALLS.iter().any(|c| line.contains(c)) {
            continue;
        }
        let end = (i + 4).min(lines.len());
        let window = lines[i..end].join("\n");
        for w in &words {
            if window.contains(w.as_str()) {
                out.push((i + 1, w.clone()));
            }
        }
    }
    out
}

const SCRIPT_EXTENSIONS: [&str; 9] = ["rs", "ts", "tsx", "js", "mjs", "cjs", "sh", "py", "yml"];

fn is_test_or_script(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .is_some_and(|e| SCRIPT_EXTENSIONS.contains(&e))
}

#[test]
fn the_read_detector_catches_direct_and_split_paths() {
    let direct = [
        "std::fs::read_to_string(\"../../docs/",
        "super",
        "powers/x.md\")",
    ]
    .concat();
    assert!(!reads_of_non_public(&direct).is_empty());
    let split = [
        "readFileSync(\n  join(root, \"landing\",\n  \"",
        "lab",
        "\", \"x.html\"))",
    ]
    .concat();
    assert!(!reads_of_non_public(&split).is_empty());
    assert!(reads_of_non_public("fs::read_to_string(manifest.join(\"Cargo.toml\"))").is_empty());
    assert!(
        reads_of_non_public("// la lectura de docs/arquitectura.md no cuenta como sospechosa")
            .is_empty()
    );
}

#[test]
fn no_public_test_or_script_reads_a_non_public_file() {
    let mut offenders = Vec::new();
    // los archivos de la propia guarda llevan fixtures con llamadas de lectura de mentira;
    // que no nombran rutas internas lo comprueba `the_guard_files_themselves_are_public_and_clean`
    let own = [
        "app/src-tauri/tests/public_tree_guard.rs",
        "app/src-tauri/tests/common/public_tree.rs",
    ];
    for path in public_files()
        .into_iter()
        .filter(|p| is_test_or_script(p) && !own.contains(&p.as_str()))
    {
        let Some(text) = read_text(&path) else {
            continue;
        };
        for (line, word) in reads_of_non_public(&text) {
            offenders.push(format!("{path}:{line}: lee algo con «{word}»"));
        }
    }
    assert!(
        offenders.is_empty(),
        "{} lectura(s) de archivos no publicables desde tests o scripts públicos:\n{}",
        offenders.len(),
        offenders.join("\n")
    );
}

// ---- 3. el árbol público no depende de lo excluido -----------------------------

#[test]
fn the_public_file_list_never_contains_an_excluded_file() {
    for p in public_files() {
        assert!(!is_non_public(&p), "{p} se coló en la lista pública");
    }
    assert!(!public_files().is_empty());
}

#[test]
fn the_guard_files_themselves_are_public_and_clean() {
    // se publican con el resto: no pueden nombrar rutas internas ni leerlas
    for me in [
        "app/src-tauri/tests/public_tree_guard.rs",
        "app/src-tauri/tests/common/public_tree.rs",
    ] {
        assert!(!is_non_public(me), "{me}");
        let Some(text) = read_text(me) else {
            // revisando otro árbol (PUBLIC_TREE_ROOT) que aún no incluye la guarda: nada que comprobar
            assert!(std::env::var_os("PUBLIC_TREE_ROOT").is_some(), "falta {me}");
            continue;
        };
        assert!(
            references_in(&text).is_empty(),
            "{me}: {:?}",
            references_in(&text)
        );
    }
}
