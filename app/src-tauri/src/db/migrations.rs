use tauri_plugin_sql::{Migration, MigrationKind};

/// Esquema completo de v1: historial del portapapeles, capturas y la fila
/// única de ajustes. `screenshot_save_dir` se
/// inserta con un placeholder acá; el primer arranque real lo sobrescribe
/// con el directorio XDG Pictures resuelto vía tauri::api::path.
pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: "
            CREATE TABLE IF NOT EXISTS clipboard_history (
                id            TEXT PRIMARY KEY,
                content_type  TEXT NOT NULL CHECK (content_type IN ('text','image','link')),
                content       TEXT NOT NULL,
                preview       TEXT,
                source_app    TEXT,
                created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                pinned        INTEGER NOT NULL DEFAULT 0,
                excluded      INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_clipboard_history_created_at ON clipboard_history(created_at);
            CREATE INDEX IF NOT EXISTS idx_clipboard_history_pinned ON clipboard_history(pinned);

            CREATE TABLE IF NOT EXISTS screenshots (
                id           TEXT PRIMARY KEY,
                file_path    TEXT NOT NULL UNIQUE,
                created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                annotated    INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at);

            CREATE TABLE IF NOT EXISTS settings (
                id                          INTEGER PRIMARY KEY CHECK (id = 1),
                screenshot_save_dir         TEXT NOT NULL,
                clipboard_cap_count         INTEGER NOT NULL DEFAULT 200,
                clipboard_cap_days          INTEGER NOT NULL DEFAULT 30,
                sensitive_exclude_enabled   INTEGER NOT NULL DEFAULT 1
            );
            INSERT OR IGNORE INTO settings (id, screenshot_save_dir) VALUES (1, '__PLACEHOLDER__');
        ",
        kind: MigrationKind::Up,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    use sqlx::Row;

    #[tokio::test]
    async fn migration_creates_exactly_the_three_tables() {
        let pool = SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .expect("failed to open in-memory sqlite");

        let sql = migrations()[0].sql;
        sqlx::raw_sql(sql)
            .execute(&pool)
            .await
            .expect("migration SQL failed to apply");

        let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .fetch_all(&pool)
            .await
            .expect("failed to list tables");
        let names: Vec<String> = rows.iter().map(|r| r.get::<String, _>("name")).collect();
        assert_eq!(names, vec!["clipboard_history", "screenshots", "settings"]);
    }

    #[tokio::test]
    async fn migration_sql_is_reapplicable_without_error() {
        // tauri-plugin-sql se encarga de no re-correr una version ya aplicada,
        // trackeando eso en su propia tabla interna. Este test solo confirma
        // que el SQL en si no falla si se lo ejecuta contra una base vacia
        // (la propiedad que este archivo controla, no la del plugin).
        let pool = SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .expect("failed to open in-memory sqlite");
        let result = sqlx::raw_sql(migrations()[0].sql).execute(&pool).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn content_type_check_constraint_rejects_invalid_value() {
        let pool = SqlitePoolOptions::new()
            .connect(":memory:")
            .await
            .expect("failed to open in-memory sqlite");
        sqlx::raw_sql(migrations()[0].sql)
            .execute(&pool)
            .await
            .unwrap();

        let result = sqlx::query(
            "INSERT INTO clipboard_history (id, content_type, content) VALUES ('1', 'video', 'x')",
        )
        .execute(&pool)
        .await;
        assert!(
            result.is_err(),
            "expected the CHECK constraint to reject content_type='video'"
        );
    }
}
