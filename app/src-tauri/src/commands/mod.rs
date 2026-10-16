pub mod capture_access;
pub mod capture_flow;
pub mod hub;
pub mod output;
pub mod panel_icon;
pub mod pin;
pub mod quit;
pub mod settings;
pub mod shortcuts;
pub mod update;

use sqlx::SqlitePool;
use tauri::State;

use crate::db::{self, ClipboardEntry};

// RESERVADOS para el panel de portapapeles: registrados, pero ninguna
// capability los concede todavía (el panel no existe y la extensión no emite
// `HistoryChanged`), así que ninguna ventana puede invocarlos. Al construir el
// panel se les da su propia capability.

#[tauri::command]
pub async fn get_clipboard_history(pool: State<'_, SqlitePool>) -> Result<Vec<ClipboardEntry>, String> {
    db::get_clipboard_history(&pool, 200)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pin_clipboard_entry(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    db::pin_clipboard_entry(&pool, &id, true)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_clipboard_entry(pool: State<'_, SqlitePool>, id: String) -> Result<(), String> {
    db::delete_clipboard_entry(&pool, &id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_clipboard_history(pool: State<'_, SqlitePool>) -> Result<(), String> {
    db::clear_clipboard_history(&pool)
        .await
        .map_err(|e| e.to_string())
}
