//! Cliente de atajos contra una extensión FALSA en un bus privado
//! (`PrivateBus`, nunca el bus real): lectura, asignación, conflictos, y la
//! validación previa que impide que un valor inválido llegue a la extensión.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::commands::shortcuts::{
    check_conflicts_on, get_shortcuts_on, set_shortcut_on, EXTENSION_INACTIVE_ERROR,
};

#[derive(Default)]
struct FakeState {
    shortcuts: HashMap<String, String>,
    set_calls: Vec<(String, String)>,
}

struct FakeExtension(Arc<Mutex<FakeState>>);

#[interface(name = "org.knivchit.ClipboardService")]
impl FakeExtension {
    fn get_shortcuts(&self) -> HashMap<String, String> {
        self.0.lock().unwrap().shortcuts.clone()
    }

    fn set_shortcut(&self, action: String, accel: String) -> (bool, String) {
        let mut state = self.0.lock().unwrap();
        state.set_calls.push((action.clone(), accel.clone()));
        if accel == "<Super>l" {
            return (false, "reservado por GNOME".to_string());
        }
        if accel.is_empty() {
            state.shortcuts.remove(&action);
        } else {
            state.shortcuts.insert(action, accel);
        }
        (true, String::new())
    }

    fn check_conflicts(&self, accel: String) -> Vec<String> {
        if accel == "<Super>l" {
            vec!["Bloquear pantalla".to_string()]
        } else {
            vec![]
        }
    }
}

async fn start_fake(bus: &PrivateBus) -> (zbus::Connection, Arc<Mutex<FakeState>>) {
    let state = Arc::new(Mutex::new(FakeState::default()));
    let connection = bus.connect().await;
    connection
        .object_server()
        .at("/org/knivchit/ClipboardService", FakeExtension(state.clone()))
        .await
        .unwrap();
    connection.request_name("org.knivchit.ClipboardService").await.unwrap();
    (connection, state)
}

#[tokio::test]
async fn without_the_extension_reads_are_empty_and_writes_say_why() {
    let bus = PrivateBus::spawn();
    let client = bus.connect().await;

    let info = get_shortcuts_on(&client).await.unwrap();
    assert!(!info.extension_active);
    assert!(info.shortcuts.is_empty());

    assert_eq!(
        set_shortcut_on(&client, "capture", "<Super>c").await,
        Err(EXTENSION_INACTIVE_ERROR.to_string())
    );
    assert_eq!(
        check_conflicts_on(&client, "<Super>c").await,
        Err(EXTENSION_INACTIVE_ERROR.to_string())
    );
}

#[tokio::test]
async fn set_then_get_round_trips_and_clearing_removes_it() {
    let bus = PrivateBus::spawn();
    let (_ext, state) = start_fake(&bus).await;
    let client = bus.connect().await;

    let info = get_shortcuts_on(&client).await.unwrap();
    assert!(info.extension_active);
    assert!(info.shortcuts.is_empty());

    set_shortcut_on(&client, "capture", "<Super><Shift>c").await.unwrap();
    let info = get_shortcuts_on(&client).await.unwrap();
    assert_eq!(info.shortcuts.get("capture").map(String::as_str), Some("<Super><Shift>c"));

    set_shortcut_on(&client, "capture", "").await.unwrap();
    assert!(get_shortcuts_on(&client).await.unwrap().shortcuts.is_empty());
    assert_eq!(state.lock().unwrap().set_calls.len(), 2);
}

#[tokio::test]
async fn a_rejection_from_the_extension_becomes_an_error_with_its_message() {
    let bus = PrivateBus::spawn();
    let (_ext, _state) = start_fake(&bus).await;
    let client = bus.connect().await;

    assert_eq!(
        set_shortcut_on(&client, "capture", "<Super>l").await,
        Err("reservado por GNOME".to_string())
    );
}

#[tokio::test]
async fn conflicts_are_returned_for_display() {
    let bus = PrivateBus::spawn();
    let (_ext, _state) = start_fake(&bus).await;
    let client = bus.connect().await;

    assert_eq!(
        check_conflicts_on(&client, "<Super>l").await,
        Ok(vec!["Bloquear pantalla".to_string()])
    );
    assert_eq!(check_conflicts_on(&client, "<Super>c").await, Ok(vec![]));
}

#[tokio::test]
async fn invalid_input_never_reaches_the_extension() {
    let bus = PrivateBus::spawn();
    let (_ext, state) = start_fake(&bus).await;
    let client = bus.connect().await;

    for (action, accel) in [
        ("emoji", "<Super>e"),
        ("capture", "c"),
        ("capture", "<Super>c\n"),
        ("capture", "<Nope>c"),
        ("capture", "<Super>\0"),
    ] {
        assert!(set_shortcut_on(&client, action, accel).await.is_err(), "{action} {accel:?}");
    }
    assert!(check_conflicts_on(&client, "").await.is_err());
    assert!(check_conflicts_on(&client, "x").await.is_err());
    assert!(state.lock().unwrap().set_calls.is_empty());
}
