//! Helpers compartidos por los tests de integración de salida de captura
//! (`save_capture`, `copy_capture`, `pin_capture`). Independientes de la
//! implementación del backend: solo fabrican entradas y directorios.
//!
//! Tabla de casos que cubren los tests (salida de captura):
//!
//! | Caso                                   | Entrada                              | Esperado                       |
//! |----------------------------------------|--------------------------------------|--------------------------------|
//! | PNG válido                             | `png(w, h)`                          | acepta                         |
//! | No es PNG (JPEG, GIF, texto)           | `NOT_PNG_CASES`                      | rechaza, nada escrito          |
//! | Cuerpo vacío                           | `&[]`                                | rechaza                        |
//! | Firma PNG con cuerpo truncado          | `truncated_png()`                    | rechaza                        |
//! | Exactamente 64 MiB                     | `padded_png(MAX_BYTES)`              | acepta                         |
//! | 64 MiB + 1                             | `padded_png(MAX_BYTES + 1)`          | rechaza                        |
//! | 16384 px de ancho / de alto            | `png(16384, 1)` / `png(1, 16384)`    | acepta                         |
//! | 16385 px de ancho / de alto            | `png(16385, 1)` / `png(1, 16385)`    | rechaza                        |
//! | Nombre único                           | dos guardados en el mismo segundo    | `-1`, `-2`; nunca sobrescribe  |
//! | `~` y `~/sub`                          | `x-save-dir`                         | resuelve al home real          |
//! | Directorio inexistente anidado         | `<tmp>/a/b/c`                        | lo crea                        |
//! | carpeta (ajustes) con espacios, ñ y `%`     | `SAVE_DIR_AWKWARD`                   | decodifica bien, escribe ahí   |
//! | carpeta (ajustes) vacía                 | —                                    | rechaza                        |
//! | Ruta que es un archivo                 | `save_dir` = archivo existente       | rechaza                        |
//! | Captura pendiente                      | segunda llamada sin captura nueva    | error, no éxito silencioso     |
//! | `pin_capture`                          | `x-width`/`x-height`                 | label `pin-<uuid>`             |

#![allow(dead_code)]

pub mod private_bus;

use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_SIDE: u32 = 16384;

/// Firma de 8 bytes de todo PNG.
pub const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Directorio con espacios, acentos, ñ y `%` — el frontend lo manda URL-encoded.
pub const SAVE_DIR_AWKWARD: &str = "Capturas de pantalla/ñandú 100%";

/// Cuerpos que NO son PNG: (nombre del caso, bytes).
pub const NOT_PNG_CASES: &[(&str, &[u8])] = &[
    ("vacío", b""),
    ("texto", b"esto no es una imagen"),
    (
        "jpeg",
        &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F'],
    ),
    ("gif", b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"),
    ("firma incompleta", &[0x89, b'P', b'N', b'G']),
    (
        "firma casi correcta",
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0B],
    ),
];

/// PNG válido de `w`×`h` píxeles.
pub fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).unwrap();
    out.into_inner()
}

/// Firma PNG válida seguida de un cuerpo cortado a la mitad.
pub fn truncated_png() -> Vec<u8> {
    let full = png(32, 32);
    full[..full.len() / 2].to_vec()
}

/// CRC-32 (IEEE) de los chunks PNG.
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

/// PNG válido de exactamente `total` bytes: se inserta un chunk ancilar
/// `teXt` con relleno ANTES de `IEND`, así sigue siendo un PNG íntegro.
/// Sirve para probar el límite de tamaño sin construir una imagen gigante.
pub fn padded_png(total: usize) -> Vec<u8> {
    let base = png(2, 2);
    let (head, iend) = base.split_at(base.len() - 12);
    let overhead = 12; // longitud + tipo + CRC del chunk de relleno
    assert!(
        total >= base.len() + overhead,
        "total menor que el PNG base"
    );
    let data_len = total - base.len() - overhead;
    let mut chunk_body = b"teXt".to_vec();
    chunk_body.extend(std::iter::repeat_n(0u8, data_len));
    let mut out = head.to_vec();
    out.extend_from_slice(&(data_len as u32).to_be_bytes());
    out.extend_from_slice(&chunk_body);
    out.extend_from_slice(&crc32(&chunk_body).to_be_bytes());
    out.extend_from_slice(iend);
    assert_eq!(out.len(), total);
    out
}

/// Directorio temporal único, borrado al salir del alcance (también si el test falla).
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new() -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let unique = format!(
            "knivchit-qa-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let path = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    /// Nombres de los archivos del directorio, ordenados.
    pub fn file_names(&self) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&self.0)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Dimensiones (ancho, alto) de un PNG ya escrito en disco.
pub fn png_size_on_disk(path: &Path) -> (u32, u32) {
    image::image_dimensions(path).unwrap()
}

/// Equivalente a `encodeURIComponent` de JS.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Pool en memoria con el esquema real. `save_capture` lee la carpeta de
/// `Settings.screenshot_save_dir` (ya no del header `x-save-dir`), así que los
/// tests de IPC la manejan con `set_save_dir`.
pub fn memory_pool() -> sqlx::SqlitePool {
    tauri::async_runtime::block_on(async {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(":memory:")
            .await
            .unwrap();
        sqlx::raw_sql(knivchit_lib::db::migrations::migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();
        pool
    })
}

/// Escribe `dir` TAL CUAL en los ajustes, sin pasar por la validación de
/// `update_settings`, para poder probar que `save_capture` rechaza lo inseguro.
pub fn set_save_dir(pool: &sqlx::SqlitePool, dir: &str) {
    tauri::async_runtime::block_on(async {
        sqlx::query("UPDATE settings SET screenshot_save_dir = ? WHERE id = 1")
            .bind(dir)
            .execute(pool)
            .await
            .unwrap();
    });
}
