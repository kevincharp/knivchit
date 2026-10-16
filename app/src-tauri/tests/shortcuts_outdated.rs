//! Una extensión VIEJA (dueña del nombre pero sin los métodos de atajos)
//! debe dar `extension_outdated`, no un fallo genérico. Extensión falsa en un
//! bus privado.

mod common;

use std::time::Duration;
use std::sync::atomic::AtomicBool;

use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::commands::shortcuts::{
    check_conflicts_on, get_shortcuts_on, record_shortcut_on, set_shortcut_on,
    EXTENSION_OUTDATED_ERROR,
};

/// Lo único que exponía la extensión anterior a los atajos.
struct OldExtension;

#[interface(name = "org.knivchit.ClipboardService")]
impl OldExtension {
    fn ping(&self) -> String {
        "pong".to_string()
    }
}

async fn start_old(bus: &PrivateBus, with_object: bool) -> zbus::Connection {
    let connection = bus.connect().await;
    // Sin ningún objeto exportado zbus ni siquiera contesta (cuelga hasta el
    // timeout); una extensión GJS real sí contesta UnknownObject. Se simula
    // exportando la interfaz en OTRA ruta.
    let path = if with_object { "/org/knivchit/ClipboardService" } else { "/org/knivchit/Otro" };
    connection.object_server().at(path, OldExtension).await.unwrap();
    connection.request_name("org.knivchit.ClipboardService").await.unwrap();
    connection
}

async fn assert_all_outdated(client: &zbus::Connection) {
    let outdated = Err(EXTENSION_OUTDATED_ERROR.to_string());
    assert_eq!(get_shortcuts_on(client).await.map(|i| i.extension_active), outdated.clone().map(|_: ()| true));
    assert_eq!(set_shortcut_on(client, "capture", "<Super>c").await, outdated.clone());
    assert_eq!(check_conflicts_on(client, "<Super>c").await, outdated.clone().map(|_: ()| vec![]));
    let flag = AtomicBool::new(false);
    assert_eq!(
        record_shortcut_on(client, Duration::from_secs(5), &flag).await,
        outdated.map(|_: ()| unreachable!())
    );
}

#[tokio::test]
async fn an_extension_without_the_shortcut_methods_is_reported_as_outdated() {
    let bus = PrivateBus::spawn();
    let _ext = start_old(&bus, true).await;
    let client = bus.connect().await;
    assert_all_outdated(&client).await;
}

#[tokio::test]
async fn an_extension_without_the_object_is_reported_as_outdated_too() {
    let bus = PrivateBus::spawn();
    let _ext = start_old(&bus, false).await;
    let client = bus.connect().await;
    assert_all_outdated(&client).await;
}
