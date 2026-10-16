//! Arranque con la sesión: contenido del `.desktop` y límites de escritura.
//! Casos adversariales sobre la API pública, aparte de los unitarios de backend.

mod common;

use std::path::Path;

use common::TempDir;
use knivchit_lib::commands::hub::{
    autostart_desktop_content, autostart_dir, get_autostart_in, set_autostart_in,
};

const EXEC: &str = "/opt/Knivchit.AppImage";

#[test]
fn only_knivchit_desktop_is_written_and_nothing_outside_the_dir() {
    let root = TempDir::new();
    let dir = root.path().join("config/autostart");
    set_autostart_in(&dir, true, Path::new(EXEC)).unwrap();

    assert_eq!(
        std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>(),
        vec!["knivchit.desktop".to_string()]
    );
    assert_eq!(
        std::fs::read_dir(root.path().join("config")).unwrap().count(),
        1,
        "no se crea nada junto a la carpeta de autostart"
    );
}

#[test]
fn enabling_twice_is_idempotent_and_get_autostart_follows_the_file() {
    let root = TempDir::new();
    let dir = root.path().join("autostart");
    assert!(!get_autostart_in(&dir));
    set_autostart_in(&dir, true, Path::new(EXEC)).unwrap();
    let first = std::fs::read_to_string(dir.join("knivchit.desktop")).unwrap();
    set_autostart_in(&dir, true, Path::new(EXEC)).unwrap();
    assert_eq!(first, std::fs::read_to_string(dir.join("knivchit.desktop")).unwrap());
    assert!(get_autostart_in(&dir));
    set_autostart_in(&dir, false, Path::new(EXEC)).unwrap();
    assert!(!get_autostart_in(&dir));
}

#[test]
fn disabling_leaves_other_autostart_entries_alone() {
    let root = TempDir::new();
    let dir = root.path().join("autostart");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("otra-app.desktop"), "[Desktop Entry]\n").unwrap();
    set_autostart_in(&dir, true, Path::new(EXEC)).unwrap();
    set_autostart_in(&dir, false, Path::new(EXEC)).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.join("otra-app.desktop")).unwrap(),
        "[Desktop Entry]\n"
    );
}

#[test]
fn a_directory_named_like_the_entry_is_not_reported_as_enabled() {
    let root = TempDir::new();
    let dir = root.path().join("autostart");
    std::fs::create_dir_all(dir.join("knivchit.desktop")).unwrap();
    assert!(!get_autostart_in(&dir));
}

#[test]
fn the_desktop_file_has_a_single_exec_line_and_no_extra_keys_from_the_path() {
    for exec in ["/opt/a b/V.AppImage", "/opt/\u{f1}and\u{fa}/V.AppImage", "/opt/x;y/V"] {
        let c = autostart_desktop_content(Path::new(exec)).unwrap();
        assert_eq!(c.lines().filter(|l| l.starts_with("Exec=")).count(), 1, "{c}");
        assert!(c.ends_with("--hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"), "{c}");
    }
}

#[test]
fn control_characters_in_the_path_never_reach_the_file() {
    for bad in ["/a\nExec=/bin/evil", "/a\r/b", "/a\0b"] {
        assert!(autostart_desktop_content(Path::new(bad)).is_err(), "{bad:?}");
    }
}

// La especificación Desktop Entry trata `%` como código de campo en `Exec`
// (`%f`, `%u`…): un `%` literal de la ruta se escribe `%%`.
#[test]
fn a_percent_in_the_path_is_escaped_as_a_literal_percent() {
    let c = autostart_desktop_content(Path::new("/home/u/100%/Knivchit")).unwrap();
    assert!(c.contains("Exec=\"/home/u/100%%/Knivchit\" --hidden\n"), "{c}");
}

#[test]
fn field_codes_in_the_path_never_survive_as_codes() {
    let c = autostart_desktop_content(Path::new("/h/%f/%U/%%/V")).unwrap();
    assert!(c.contains("Exec=\"/h/%%f/%%U/%%%%/V\" --hidden\n"), "{c}");
}

#[test]
fn spaces_quotes_dollar_and_backticks_stay_inside_one_quoted_argument() {
    let c = autostart_desktop_content(Path::new("/h/Mis apps/a\"b$c`d/V")).unwrap();
    let exec = c.lines().find(|l| l.starts_with("Exec=")).unwrap();
    assert_eq!(exec, r#"Exec="/h/Mis apps/a\\"b\\$c\\`d/V" --hidden"#);
}

#[test]
fn autostart_dir_ignores_a_relative_xdg_and_a_relative_home() {
    assert!(autostart_dir(Some("relativo".into()), None).is_err());
    assert!(autostart_dir(Some("relativo".into()), Some("tambien/relativo".into())).is_err());
    assert_eq!(
        autostart_dir(Some("relativo".into()), Some("/home/u".into())).unwrap(),
        Path::new("/home/u/.config/autostart")
    );
}
