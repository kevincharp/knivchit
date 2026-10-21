use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;

use knivchit_lib::db;

async fn fresh_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new().connect(":memory:").await.unwrap();
    sqlx::raw_sql(db::migrations::migrations()[0].sql)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

#[tokio::test]
async fn eviction_never_removes_pinned_rows() {
    let pool = fresh_pool().await;

    db::insert_clipboard_entry(&pool, "text", "pinned", None)
        .await
        .unwrap();
    sqlx::query("UPDATE clipboard_history SET pinned = 1 WHERE content = 'pinned'")
        .execute(&pool)
        .await
        .unwrap();

    for i in 0..10 {
        db::insert_clipboard_entry(&pool, "text", &format!("unpinned-{i}"), None)
            .await
            .unwrap();
    }

    db::evict_clipboard_history(&pool, 3).await.unwrap();

    let rows = sqlx::query("SELECT content, pinned FROM clipboard_history")
        .fetch_all(&pool)
        .await
        .unwrap();

    let pinned_survived = rows.iter().any(|r| r.get::<String, _>("content") == "pinned");
    assert!(pinned_survived, "la fila fijada nunca debe borrarse por el cap");

    let unpinned_count = rows
        .iter()
        .filter(|r| r.get::<i64, _>("pinned") == 0)
        .count();
    assert_eq!(unpinned_count, 3, "deben sobrevivir exactamente 3 filas no fijadas");
}
