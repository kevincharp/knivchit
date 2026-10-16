//! Comprueba que los helpers de `common` fabrican lo que dicen fabricar:
//! si un helper miente, los tests de validación del backend serían vacuos.

mod common;

use common::*;

#[test]
fn png_valid_has_signature_and_requested_size() {
    let bytes = png(7, 3);
    assert_eq!(&bytes[..8], &PNG_SIGNATURE);
    let img = image::load_from_memory(&bytes).unwrap();
    assert_eq!((img.width(), img.height()), (7, 3));
}

#[test]
fn extreme_dimensions_are_really_that_size() {
    for (w, h) in [
        (MAX_SIDE, 1),
        (1, MAX_SIDE),
        (MAX_SIDE + 1, 1),
        (1, MAX_SIDE + 1),
    ] {
        let bytes = png(w, h);
        let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .unwrap();
        assert_eq!(reader.into_dimensions().unwrap(), (w, h));
    }
}

#[test]
fn not_png_cases_are_not_decodable_pngs() {
    for (name, bytes) in NOT_PNG_CASES {
        assert!(
            !bytes.starts_with(&PNG_SIGNATURE),
            "el caso «{name}» no debería llevar firma PNG completa"
        );
    }
}

#[test]
fn truncated_png_keeps_signature_but_does_not_decode() {
    let bytes = truncated_png();
    assert_eq!(&bytes[..8], &PNG_SIGNATURE);
    assert!(image::load_from_memory(&bytes).is_err());
}

#[test]
fn padded_png_has_exact_length_and_still_decodes() {
    for total in [1000, 5000, 200_000] {
        let bytes = padded_png(total);
        assert_eq!(bytes.len(), total);
        assert!(image::load_from_memory(&bytes).is_ok());
    }
}

#[test]
fn tempdir_is_unique_and_removed_on_drop() {
    let (a_path, b_path);
    {
        let a = TempDir::new();
        let b = TempDir::new();
        assert_ne!(a.path(), b.path());
        std::fs::write(a.path().join("x.png"), b"x").unwrap();
        assert_eq!(a.file_names(), vec!["x.png".to_string()]);
        a_path = a.path().to_path_buf();
        b_path = b.path().to_path_buf();
    }
    assert!(!a_path.exists());
    assert!(!b_path.exists());
}

#[test]
fn encode_uri_component_matches_js_for_awkward_dir() {
    assert_eq!(
        encode_uri_component(SAVE_DIR_AWKWARD),
        "Capturas%20de%20pantalla%2F%C3%B1and%C3%BA%20100%25"
    );
    assert_eq!(encode_uri_component("~/a b"), "~%2Fa%20b");
}
