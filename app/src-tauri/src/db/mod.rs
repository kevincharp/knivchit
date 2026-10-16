pub mod migrations;

use sqlx::sqlite::SqlitePool;

/// Único módulo que abre la conexión SQLite: ningún comando ni test abre su
/// propia conexión contra el archivo real.
///
/// Ojo: el registro de
/// `tauri_plugin_sql::Builder::add_migrations` en `lib.rs` nunca aplica nada
/// por sí solo — ese plugin solo corre sus migraciones cuando el frontend
/// llama `Database.load(...)` desde JS, y esta app nunca lo hace (todo pasa
/// por comandos Rust). Este pool es el único que de verdad se
/// usa, así que es el único lugar donde el esquema puede aplicarse. El SQL de
/// la migración usa `IF NOT EXISTS`/`INSERT OR IGNORE` para poder correr en
/// cada arranque sin fallar sobre una base ya inicializada.
pub async fn open_pool(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePool::connect(db_path).await?;
    sqlx::raw_sql(migrations::migrations()[0].sql)
        .execute(&pool)
        .await?;
    Ok(pool)
}

/// Valida una base copiada (migración desde el nombre anterior) SIN modificarla:
/// la abre en solo lectura, `PRAGMA integrity_check` debe dar `ok` y la tabla
/// `clipboard_history` debe existir. Solo devuelve metadatos del fallo: nunca
/// filas ni contenido.
pub async fn check_database(path: &std::path::Path) -> Result<(), String> {
    use sqlx::sqlite::SqliteConnectOptions;
    use sqlx::{ConnectOptions, Connection};
    let mut conn = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .connect()
        .await
        .map_err(|_| "la base no se puede abrir".to_string())?;
    let verdict: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(&mut conn)
        .await
        .map_err(|_| "falló la comprobación de integridad".to_string())?;
    if verdict != "ok" {
        return Err("la comprobación de integridad no dio ok".to_string());
    }
    let _count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_history")
        .fetch_one(&mut conn)
        .await
        .map_err(|_| "falta la tabla clipboard_history".to_string())?;
    let _ = conn.close().await;
    Ok(())
}

/// Inserta una entrada nueva en `clipboard_history`. `source_app` puede ser
/// `None` — nunca es un error (la señal `HistoryChanged` puede llegar sin él).
pub async fn insert_clipboard_entry(
    pool: &SqlitePool,
    content_type: &str,
    content: &str,
    source_app: Option<&str>,
) -> Result<(), sqlx::Error> {
    let id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO clipboard_history (id, content_type, content, source_app) VALUES (?, ?, ?, ?)",
    )
    .bind(id)
    .bind(content_type)
    .bind(content)
    .bind(source_app)
    .execute(pool)
    .await?;
    Ok(())
}

/// Borra las filas más viejas no fijadas que excedan `cap_count`. Nunca toca
/// una fila con `pinned = 1`: el filtro `pinned = 0` va ANTES de ordenar y
/// limitar, sin excepción.
pub async fn evict_clipboard_history(pool: &SqlitePool, cap_count: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM clipboard_history
         WHERE pinned = 0
           AND id NOT IN (
               SELECT id FROM clipboard_history
               WHERE pinned = 0
               ORDER BY created_at DESC
               LIMIT ?
           )",
    )
    .bind(cap_count)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClipboardEntry {
    pub id: String,
    pub content_type: String,
    pub content: String,
    pub preview: Option<String>,
    pub source_app: Option<String>,
    pub created_at: String,
    pub pinned: bool,
}

/// Lee el historial ordenado por más reciente primero.
pub async fn get_clipboard_history(
    pool: &SqlitePool,
    limit: i64,
) -> Result<Vec<ClipboardEntry>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, Option<String>, String, i64)>(
        "SELECT id, content_type, content, preview, source_app, created_at, pinned
         FROM clipboard_history ORDER BY created_at DESC LIMIT ?",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, content_type, content, preview, source_app, created_at, pinned)| ClipboardEntry {
                id,
                content_type,
                content,
                preview,
                source_app,
                created_at,
                pinned: pinned != 0,
            },
        )
        .collect())
}

pub async fn pin_clipboard_entry(pool: &SqlitePool, id: &str, pinned: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE clipboard_history SET pinned = ? WHERE id = ?")
        .bind(pinned)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_clipboard_entry(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM clipboard_history WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn clear_clipboard_history(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM clipboard_history").execute(pool).await?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub screenshot_save_dir: String,
    pub clipboard_cap_count: i64,
    pub clipboard_cap_days: i64,
    pub sensitive_exclude_enabled: bool,
}

/// `settings` es una fila única (`id = 1`, forzado por un `CHECK`): toda
/// escritura es un `UPDATE`, nunca se inserta una segunda fila.
pub async fn get_settings(pool: &SqlitePool) -> Result<Settings, sqlx::Error> {
    let row = sqlx::query_as::<_, (String, i64, i64, i64)>(
        "SELECT screenshot_save_dir, clipboard_cap_count, clipboard_cap_days, sensitive_exclude_enabled
         FROM settings WHERE id = 1",
    )
    .fetch_one(pool)
    .await?;

    Ok(Settings {
        screenshot_save_dir: row.0,
        clipboard_cap_count: row.1,
        clipboard_cap_days: row.2,
        sensitive_exclude_enabled: row.3 != 0,
    })
}

pub const MAX_CLIPBOARD_CAP_COUNT: i64 = 10_000;
pub const MAX_CLIPBOARD_CAP_DAYS: i64 = 3650;

/// Rechaza `clipboard_cap_count`/`clipboard_cap_days` negativos antes de
/// tocar SQLite: Rust valida primero y el `CHECK` de SQL es la segunda
/// barrera, no la única.
pub async fn update_settings(pool: &SqlitePool, settings: &Settings) -> Result<(), String> {
    if settings.clipboard_cap_count < 0 {
        return Err("clipboard_cap_count no puede ser negativo".to_string());
    }
    if settings.clipboard_cap_days < 0 {
        return Err("clipboard_cap_days no puede ser negativo".to_string());
    }
    if settings.clipboard_cap_count > MAX_CLIPBOARD_CAP_COUNT {
        return Err(format!("clipboard_cap_count no puede superar {MAX_CLIPBOARD_CAP_COUNT}"));
    }
    if settings.clipboard_cap_days > MAX_CLIPBOARD_CAP_DAYS {
        return Err(format!("clipboard_cap_days no puede superar {MAX_CLIPBOARD_CAP_DAYS}"));
    }

    sqlx::query(
        "UPDATE settings SET screenshot_save_dir = ?, clipboard_cap_count = ?,
         clipboard_cap_days = ?, sensitive_exclude_enabled = ? WHERE id = 1",
    )
    .bind(&settings.screenshot_save_dir)
    .bind(settings.clipboard_cap_count)
    .bind(settings.clipboard_cap_days)
    .bind(settings.sensitive_exclude_enabled)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod settings {
    use super::*;

    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::raw_sql(migrations::migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn update_settings_persists_new_cap_count() {
        let pool = fresh_pool().await;
        let mut settings = get_settings(&pool).await.unwrap();
        settings.clipboard_cap_count = 50;

        update_settings(&pool, &settings).await.unwrap();

        let reloaded = get_settings(&pool).await.unwrap();
        assert_eq!(reloaded.clipboard_cap_count, 50);
    }

    #[tokio::test]
    async fn update_settings_rejects_negative_cap_count_without_persisting() {
        let pool = fresh_pool().await;
        let mut settings = get_settings(&pool).await.unwrap();
        settings.clipboard_cap_count = -1;

        let result = update_settings(&pool, &settings).await;
        assert!(result.is_err());

        let reloaded = get_settings(&pool).await.unwrap();
        assert_ne!(reloaded.clipboard_cap_count, -1, "el valor invalido no debe persistir");
    }
}

#[cfg(test)]
mod persistence_tests {
    use super::*;
    use sqlx::Row;

    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::raw_sql(migrations::migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn insert_then_evict_keeps_pinned_rows() {
        let pool = fresh_pool().await;

        // Una entrada fijada, agregada primero (la más vieja).
        insert_clipboard_entry(&pool, "text", "pinned-entry", None)
            .await
            .unwrap();
        sqlx::query("UPDATE clipboard_history SET pinned = 1 WHERE content = 'pinned-entry'")
            .execute(&pool)
            .await
            .unwrap();

        for i in 0..5 {
            insert_clipboard_entry(&pool, "text", &format!("entry-{i}"), None)
                .await
                .unwrap();
        }

        evict_clipboard_history(&pool, 2).await.unwrap();

        let rows = sqlx::query("SELECT content, pinned FROM clipboard_history ORDER BY created_at")
            .fetch_all(&pool)
            .await
            .unwrap();

        let contents: Vec<String> = rows.iter().map(|r| r.get("content")).collect();
        assert!(
            contents.contains(&"pinned-entry".to_string()),
            "la fila fijada nunca debe borrarse: {contents:?}"
        );

        let unpinned_count = rows
            .iter()
            .filter(|r| r.get::<i64, _>("pinned") == 0)
            .count();
        assert_eq!(unpinned_count, 2, "deberían sobrevivir exactamente 2 filas no fijadas");
    }
}

#[cfg(test)]
mod open_pool_tests {
    use super::*;

    // Regresión (visto en la primera corrida de `pnpm tauri dev`):
    // open_pool debe poder llamarse contra un archivo ya migrado (cada
    // arranque de la app real vuelve a llamarlo) sin fallar.
    #[tokio::test]
    async fn open_pool_is_idempotent_against_an_already_migrated_file() {
        let dir = std::env::temp_dir().join(format!("knivchit-dbtest-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db_url = format!("sqlite:{}/knivchit.db?mode=rwc", dir.display());

        open_pool(&db_url)
            .await
            .expect("la primera apertura debe crear el esquema");

        let second = open_pool(&db_url).await;
        assert!(
            second.is_ok(),
            "reabrir un archivo ya migrado no debe fallar: {:?}",
            second.err()
        );

        let settings = get_settings(&second.unwrap()).await;
        assert!(settings.is_ok(), "el esquema debe seguir siendo consultable");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod settings_limits {
    use super::*;

    async fn fresh_pool() -> SqlitePool {
        let pool = SqlitePool::connect(":memory:").await.unwrap();
        sqlx::raw_sql(migrations::migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn update_settings_rejects_caps_above_the_maximum() {
        let pool = fresh_pool().await;
        let mut s = get_settings(&pool).await.unwrap();
        s.clipboard_cap_count = MAX_CLIPBOARD_CAP_COUNT + 1;
        assert!(update_settings(&pool, &s).await.is_err());
        s.clipboard_cap_count = MAX_CLIPBOARD_CAP_COUNT;
        s.clipboard_cap_days = MAX_CLIPBOARD_CAP_DAYS + 1;
        assert!(update_settings(&pool, &s).await.is_err());
        s.clipboard_cap_days = MAX_CLIPBOARD_CAP_DAYS;
        assert!(update_settings(&pool, &s).await.is_ok());
    }
}
