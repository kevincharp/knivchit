//! Contrato entre la extensión (XML de la interfaz en
//! `extension/lib/clipboardService.js`) y el cliente de la app (trait
//! `ExtensionShortcuts` de `commands/shortcuts.rs`), comprobado sin GNOME:
//! nombres de método, tipos D-Bus de entrada y salida, y los estados de
//! `RecordShortcut` a ambos lados. También los métodos de `org.knivchit.App`
//! que la extensión llama frente a los que la app implementa. Una
//! desalineación (un método renombrado, un tipo cambiado, un estado nuevo en
//! un solo lado) se detecta aquí y no en la sesión real del usuario.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use knivchit_lib::commands::shortcuts::RecordStatus;

fn repo_file(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..").join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

#[derive(Debug, PartialEq, Eq, Default, Clone)]
struct Sig {
    ins: Vec<String>,
    outs: Vec<String>,
}

/// Valor de `name="…"` / `type="…"` dentro de una etiqueta.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let key = format!("{name}=\"");
    let start = tag.find(&key)? + key.len();
    let end = start + tag[start..].find('"')?;
    Some(&tag[start..end])
}

/// Métodos de la interfaz D-Bus de la extensión, tal como los exporta su XML.
fn extension_methods() -> BTreeMap<String, Sig> {
    let js = repo_file("extension/lib/clipboardService.js");
    let start = js.find("const IFACE_XML = `").expect("sin IFACE_XML") + 19;
    let xml = &js[start..start + js[start..].find('`').unwrap()];
    let mut methods = BTreeMap::new();
    let mut current: Option<(String, Sig)> = None;
    for raw in xml.lines() {
        let line = raw.trim();
        if line.starts_with("<method ") {
            let sig = Sig::default();
            if line.ends_with("/>") {
                methods.insert(attr(line, "name").unwrap().to_string(), sig);
            } else {
                current = Some((attr(line, "name").unwrap().to_string(), sig));
            }
        } else if line.starts_with("</method>") {
            let (n, s) = current.take().expect("</method> sin <method>");
            methods.insert(n, s);
        } else if line.starts_with("<arg ") {
            if let Some((_, sig)) = current.as_mut() {
                let ty = attr(line, "type").unwrap().to_string();
                match attr(line, "direction") {
                    Some("out") => sig.outs.push(ty),
                    _ => sig.ins.push(ty),
                }
            }
        }
    }
    methods
}

fn pascal(snake: &str) -> String {
    snake
        .split('_')
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
        })
        .collect()
}

/// Tipo Rust → firma D-Bus. Solo los tipos que usa el contrato.
fn dbus_type(rust: &str) -> Vec<String> {
    let t = rust.trim().replace(' ', "");
    match t.as_str() {
        "()" => vec![],
        "&str" | "String" => vec!["s".into()],
        "bool" => vec!["b".into()],
        "Vec<String>" => vec!["as".into()],
        "HashMap<String,String>" => vec!["a{ss}".into()],
        _ if t.starts_with('(') && t.ends_with(')') => t[1..t.len() - 1]
            .split(',')
            .flat_map(dbus_type)
            .collect(),
        other => panic!("tipo Rust sin equivalente D-Bus conocido en el contrato: {other}"),
    }
}

/// Métodos del trait `ExtensionShortcuts` (cliente de la app).
fn client_methods() -> BTreeMap<String, Sig> {
    let rs = repo_file("app/src-tauri/src/commands/shortcuts.rs");
    let start = rs.find("trait ExtensionShortcuts {").expect("sin trait ExtensionShortcuts");
    let body = &rs[start..start + rs[start..].find("\n}").unwrap()];
    let mut out = BTreeMap::new();
    for line in body.lines().map(str::trim).filter(|l| l.starts_with("fn ")) {
        let name = line["fn ".len()..line.find('(').unwrap()].to_string();
        let params = &line[line.find('(').unwrap() + 1..line.find(')').unwrap()];
        let ins = params
            .split(',')
            .map(str::trim)
            .filter(|p| !p.is_empty() && *p != "&self")
            .flat_map(|p| dbus_type(p.split_once(':').expect("parámetro sin tipo").1))
            .collect();
        let ret = line.split("zbus::Result<").nth(1).expect("sin zbus::Result");
        let ret = &ret[..ret.rfind(">;").unwrap()];
        out.insert(pascal(&name), Sig { ins, outs: dbus_type(ret) });
    }
    out
}

#[test]
fn the_scanners_read_both_sides() {
    assert!(extension_methods().contains_key("RecordShortcut"));
    assert!(client_methods().contains_key("RecordShortcut"));
    assert_eq!(
        client_methods()["SetShortcut"],
        Sig { ins: vec!["s".into(), "s".into()], outs: vec!["b".into(), "s".into()] }
    );
}

#[test]
fn every_method_the_app_calls_exists_in_the_extension_with_the_same_signature() {
    let ext = extension_methods();
    for (name, client) in client_methods() {
        let published = ext
            .get(&name)
            .unwrap_or_else(|| panic!("la app llama a {name} y la extensión no lo publica"));
        assert_eq!(&client, published, "firma distinta en {name}");
    }
}

#[test]
fn the_extension_status_strings_and_the_app_statuses_are_the_same_set() {
    // Lado extensión: todo segundo argumento literal de onResult(...)/_finish(...).
    let js = repo_file("extension/lib/shortcutRecorder.js");
    let mut ext: BTreeSet<String> = BTreeSet::new();
    for call in ["onResult(", "_finish("] {
        let mut rest = js.as_str();
        while let Some(i) = rest.find(call) {
            rest = &rest[i + call.len()..];
            let args = &rest[..rest.find(')').unwrap()];
            if let Some((_, second)) = args.rsplit_once(',') {
                let second = second.trim();
                if second.len() > 2 && second.starts_with('"') && second.ends_with('"') {
                    ext.insert(second.trim_matches('"').to_string());
                }
            }
        }
    }
    // Lado app: exhaustivo a propósito, un estado nuevo no compila sin tocar esto.
    let all = [
        RecordStatus::Ok,
        RecordStatus::Cancelled,
        RecordStatus::Timeout,
        RecordStatus::Busy,
        RecordStatus::Invalid,
        RecordStatus::Unavailable,
    ];
    for s in all {
        match s {
            RecordStatus::Ok
            | RecordStatus::Cancelled
            | RecordStatus::Timeout
            | RecordStatus::Busy
            | RecordStatus::Invalid
            | RecordStatus::Unavailable => {}
        }
    }
    let app: BTreeSet<String> = all.iter().map(|s| s.as_str().to_string()).collect();
    assert_eq!(ext, app, "estados de RecordShortcut distintos entre la extensión y la app");
    for s in &ext {
        assert_eq!(RecordStatus::parse(s).as_str(), s, "la app no interpreta «{s}» como tal");
    }
}

fn extension_timeout_ms() -> u64 {
    let js = repo_file("extension/lib/shortcutRecorder.js");
    js.lines()
        .find(|l| l.contains("DEFAULT_TIMEOUT_MS ="))
        .and_then(|l| l.split('=').nth(1))
        .map(|v| v.trim().trim_end_matches(';').replace('_', ""))
        .expect("sin DEFAULT_TIMEOUT_MS")
        .parse()
        .expect("DEFAULT_TIMEOUT_MS no numérico")
}

#[test]
fn the_app_call_outlasts_the_extension_recording() {
    let ms = extension_timeout_ms();
    let app = knivchit_lib::commands::shortcuts::RECORD_CALL_TIMEOUT.as_millis() as u64;
    assert!(app > ms, "la llamada de la app ({app} ms) debe durar más que la grabación ({ms} ms)");
}

#[test]
fn the_timeout_comment_states_the_real_extension_wait() {
    let secs = extension_timeout_ms() / 1000;
    let rs = repo_file("app/src-tauri/src/commands/shortcuts.rs");
    assert!(
        rs.contains(&format!("~{secs} s")),
        "el comentario de RECORD_CALL_TIMEOUT no menciona los {secs} s reales de la extensión"
    );
}

#[test]
fn every_app_method_the_extension_calls_is_implemented_by_the_app() {
    let js = repo_file("extension/extension.js");
    let mut called = BTreeSet::new();
    let mut rest = js.as_str();
    while let Some(i) = rest.find("_callApp(\"") {
        rest = &rest[i + "_callApp(\"".len()..];
        called.insert(rest[..rest.find('"').unwrap()].to_string());
    }
    assert!(!called.is_empty(), "no se encontró ninguna llamada _callApp");

    let rs = repo_file("app/src-tauri/src/dbus/mod.rs");
    let start = rs.find("#[interface(name = \"org.knivchit.App\")]").expect("sin interfaz App");
    let body = &rs[start..];
    let implemented: BTreeSet<String> = body
        .lines()
        .map(str::trim)
        .filter_map(|l| {
            let l = l.strip_prefix("pub ").unwrap_or(l);
            let l = l.strip_prefix("async ").unwrap_or(l);
            l.strip_prefix("fn ")
        })
        .map(|l| pascal(&l[..l.find('(').unwrap()]))
        .collect();
    let missing: Vec<_> = called.difference(&implemented).collect();
    assert!(missing.is_empty(), "la extensión llama a métodos que la app no implementa: {missing:?}");
}

#[test]
fn the_history_changed_signal_has_the_same_payload_on_both_sides() {
    let js = repo_file("extension/lib/clipboardService.js");
    assert!(js.contains("<signal name=\"HistoryChanged\">\n      <arg type=\"a{sv}\" name=\"entry\"/>"));
    let rs = repo_file("app/src-tauri/src/dbus/mod.rs");
    let line = rs.lines().find(|l| l.contains("fn history_changed(")).expect("sin history_changed");
    assert!(line.contains("HashMap<String, OwnedValue>"), "{line}");
}

#[test]
fn the_frontend_knows_the_stable_extension_error_strings() {
    let ts = repo_file("app/src/components/shell/extensionErrors.ts");
    assert!(
        ts.contains(knivchit_lib::commands::shortcuts::EXTENSION_INACTIVE_ERROR),
        "extensionErrors.ts no reconoce el error estable de extensión inactiva"
    );
}

#[test]
fn the_frontend_handles_the_outdated_extension_error() {
    let ts = repo_file("app/src/components/shell/extensionErrors.ts");
    assert!(
        ts.contains(knivchit_lib::commands::shortcuts::EXTENSION_OUTDATED_ERROR),
        "extensionErrors.ts no reconoce el error estable de extensión desactualizada"
    );
}
