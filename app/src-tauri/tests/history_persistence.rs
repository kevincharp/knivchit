mod common;

use std::collections::HashMap;
use std::time::Duration;

use sqlx::sqlite::SqlitePoolOptions;
use sqlx::Row;
use zbus::zvariant::Value;
use zbus::Connection;

use common::private_bus::PrivateBus;
use knivchit_lib::db;
use knivchit_lib::dbus::subscribe_to_clipboard_changes;

async fn fresh_pool() -> sqlx::SqlitePool {
    let pool = SqlitePoolOptions::new().connect(":memory:").await.unwrap();
    sqlx::raw_sql(db::migrations::migrations()[0].sql)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn emit_history_changed(connection: &Connection, content_type: &str, content: &str) {
    let mut entry: HashMap<&str, Value> = HashMap::new();
    entry.insert("content_type", Value::from(content_type));
    entry.insert("content", Value::from(content));

    connection
        .emit_signal(
            None::<()>,
            "/org/knivchit/ClipboardService",
            "org.knivchit.ClipboardService",
            "HistoryChanged",
            &(entry,),
        )
        .await
        .expect("failed to emit HistoryChanged");
}

#[tokio::test]
async fn history_changed_signal_inserts_exactly_one_row() {
    let pool = fresh_pool().await;
    let bus = PrivateBus::spawn();
    let connection = bus.connect().await;

    // El proxy del suscriptor resuelve "org.knivchit.ClipboardService" a su
    // dueño actual y filtra por ese sender — sin RequestName, nadie es dueño
    // del nombre y la señal nunca matchea. La extensión real hace este mismo
    // RequestName (ver extension/extension.js).
    connection
        .request_name("org.knivchit.ClipboardService")
        .await
        .unwrap();

    let sub_pool = pool.clone();
    let sub_conn = connection.clone();
    tokio::spawn(async move {
        let _ = subscribe_to_clipboard_changes(&sub_conn, sub_pool, 200).await;
    });

    // Le da tiempo al suscriptor a registrar el match rule antes de emitir.
    tokio::time::sleep(Duration::from_millis(200)).await;

    emit_history_changed(&connection, "text", "hola mundo").await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let rows = sqlx::query("SELECT content_type, content FROM clipboard_history")
        .fetch_all(&pool)
        .await
        .unwrap();

    assert_eq!(rows.len(), 1, "debe insertar exactamente una fila");
    let content: String = rows[0].get("content");
    assert_eq!(content, "hola mundo");
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
