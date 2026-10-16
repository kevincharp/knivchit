use sqlx::SqlitePool;
use tauri::State;

use super::output::resolve_save_dir;
use crate::db::{self, Settings};

/// Longitud máxima de `screenshot_save_dir` (PATH_MAX de Linux).
const MAX_SAVE_DIR_LEN: usize = 4096;

/// Rechaza una carpeta de capturas que `save_capture` no aceptaría después:
/// vacía, demasiado larga, con NUL, relativa o con `..` (el placeholder pasa).
/// Los topes numéricos los valida `db::update_settings`.
pub fn validate_save_dir_setting(raw: &str) -> Result<(), String> {
    if raw.len() > MAX_SAVE_DIR_LEN {
        return Err(format!(
            "la carpeta de guardado supera los {MAX_SAVE_DIR_LEN} caracteres"
        ));
    }
    resolve_save_dir(raw).map(|_| ())
}

#[tauri::command]
pub async fn get_settings(pool: State<'_, SqlitePool>) -> Result<Settings, String> {
    db::get_settings(&pool).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_settings(pool: State<'_, SqlitePool>, settings: Settings) -> Result<(), String> {
    validate_save_dir_setting(&settings.screenshot_save_dir)?;
    db::update_settings(&pool, &settings).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_dir_setting_accepts_placeholder_tilde_and_absolute() {
        for ok in ["__PLACEHOLDER__", "~/Pictures/Knivchit", "/home/u/Capturas", "%2Fhome%2Fu"] {
            assert!(validate_save_dir_setting(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn save_dir_setting_rejects_unsafe_values() {
        let largo = format!("/{}", "a".repeat(MAX_SAVE_DIR_LEN));
        for bad in ["", "   ", "relativa", "../x", "/a/../b", "/tmp/nul\0", largo.as_str()] {
            assert!(validate_save_dir_setting(bad).is_err(), "{bad:?}");
        }
    }
}
