//! `get_panel_icon` / `set_panel_icon` contra una extensión FALSA en un bus
//! privado: valor normal, validación, extensión ausente, `AccessDenied` y
//! extensión antigua.

mod common;

use std::sync::{Arc, Mutex};

use zbus::fdo;
use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::commands::panel_icon::{get_panel_icon_on, set_panel_icon_on, PanelIconInfo};
use knivchit_lib::commands::shortcuts::{
    EXTENSION_INACTIVE_ERROR, EXTENSION_OUTDATED_ERROR, SHORTCUTS_UNAVAILABLE_ERROR,
};

/// Guarda el valor como la extensión real (GSettings).
struct FakeExtension(Arc<Mutex<bool>>, &'static str);

#[interface(name = "org.knivchit.ClipboardService")]
impl FakeExtension {
    async fn get_panel_icon(&self) -> bool {
        *self.0.lock().unwrap()
    }
    async fn set_panel_icon(&self, enabled: bool) -> (bool, String) {
        if !self.1.is_empty() {
            return (false, self.1.to_string());
        }
        *self.0.lock().unwrap() = enabled;
        (true, String::new())
    }
}

struct Denying;

#[interface(name = "org.knivchit.ClipboardService")]
impl Denying {
    async fn get_panel_icon(&self) -> fdo::Result<bool> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
    async fn set_panel_icon(&self, _enabled: bool) -> fdo::Result<(bool, String)> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
}

/// Extensión anterior al icono: dueña del nombre pero sin esos métodos.
struct Old;

#[interface(name = "org.knivchit.ClipboardService")]
impl Old {
    fn ping(&self) -> String {
        "pong".into()
    }
}

async fn serve<T: zbus::object_server::Interface>(bus: &PrivateBus, iface: T) -> zbus::Connection {
    let connection = bus.connect().await;
    connection.object_server().at("/org/knivchit/ClipboardService", iface).await.unwrap();
    connection.request_name("org.knivchit.ClipboardService").await.unwrap();
    connection
}

#[tokio::test]
async fn reads_and_changes_the_preference() {
    let bus = PrivateBus::spawn();
    let state = Arc::new(Mutex::new(true));
    let _ext = serve(&bus, FakeExtension(state.clone(), "")).await;
    let client = bus.connect().await;

    assert_eq!(
        get_panel_icon_on(&client).await,
        Ok(PanelIconInfo { extension_active: true, enabled: true })
    );
    set_panel_icon_on(&client, false).await.unwrap();
    assert!(!*state.lock().unwrap());
    assert_eq!(
        get_panel_icon_on(&client).await,
        Ok(PanelIconInfo { extension_active: true, enabled: false })
    );
}

#[tokio::test]
async fn a_validation_error_from_the_extension_is_returned_as_a_bounded_message() {
    let bus = PrivateBus::spawn();
    let _ext = serve(&bus, FakeExtension(Arc::new(Mutex::new(true)), "no se pudo\nahora")).await;
    let client = bus.connect().await;
    assert_eq!(set_panel_icon_on(&client, false).await, Err("no se pudoahora".to_string()));
}

#[tokio::test]
async fn without_the_extension_reading_is_not_available_and_writing_says_inactive() {
    let bus = PrivateBus::spawn();
    let client = bus.connect().await;
    assert_eq!(
        get_panel_icon_on(&client).await,
        Ok(PanelIconInfo { extension_active: false, enabled: false })
    );
    assert_eq!(set_panel_icon_on(&client, true).await, Err(EXTENSION_INACTIVE_ERROR.to_string()));
}

#[tokio::test]
async fn access_denied_is_not_available_for_reading_and_unavailable_for_writing() {
    let bus = PrivateBus::spawn();
    let _ext = serve(&bus, Denying).await;
    let client = bus.connect().await;
    assert_eq!(
        get_panel_icon_on(&client).await,
        Ok(PanelIconInfo { extension_active: false, enabled: false })
    );
    assert_eq!(
        set_panel_icon_on(&client, true).await,
        Err(SHORTCUTS_UNAVAILABLE_ERROR.to_string())
    );
}

#[tokio::test]
async fn an_old_extension_without_the_methods_is_reported_as_outdated() {
    let bus = PrivateBus::spawn();
    let _ext = serve(&bus, Old).await;
    let client = bus.connect().await;
    assert_eq!(get_panel_icon_on(&client).await, Err(EXTENSION_OUTDATED_ERROR.to_string()));
    assert_eq!(set_panel_icon_on(&client, true).await, Err(EXTENSION_OUTDATED_ERROR.to_string()));
}
