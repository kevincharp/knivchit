//! Endurecimiento de la extensión (EXT-01/EXT-02) visto desde la app, contra
//! una extensión FALSA en un bus privado: `AccessDenied` como «atajos no
//! disponibles», `busy` inmediato (cooldown de 750 ms) y `unavailable`
//! (ventana de Knivchit sin foco).

mod common;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use zbus::fdo;
use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::commands::shortcuts::{
    check_conflicts_on, get_shortcuts_on, record_shortcut_with, set_shortcut_on,
    SHORTCUTS_UNAVAILABLE_ERROR,
};

const LONG: Duration = Duration::from_secs(5);
const FAST_RETRY: Duration = Duration::from_millis(20);

/// Extensión que rechaza a la app, como la real cuando quien llama no es el
/// dueño de `org.knivchit.App`.
struct DenyingExtension;

#[interface(name = "org.knivchit.ClipboardService")]
impl DenyingExtension {
    async fn get_shortcuts(&self) -> fdo::Result<std::collections::HashMap<String, String>> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
    async fn set_shortcut(&self, _a: String, _b: String) -> fdo::Result<(bool, String)> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
    async fn check_conflicts(&self, _a: String) -> fdo::Result<Vec<String>> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
    async fn record_shortcut(&self) -> fdo::Result<(String, String)> {
        Err(fdo::Error::AccessDenied("no autorizado".into()))
    }
}

/// Responde a `record_shortcut` con la secuencia dada (la última se repite).
struct ScriptedRecorder(Arc<Mutex<Vec<(&'static str, &'static str)>>>, Arc<Mutex<u32>>);

#[interface(name = "org.knivchit.ClipboardService")]
impl ScriptedRecorder {
    async fn record_shortcut(&self) -> (String, String) {
        *self.1.lock().unwrap() += 1;
        let mut script = self.0.lock().unwrap();
        let (accel, status) = if script.len() > 1 { script.remove(0) } else { script[0] };
        (accel.to_string(), status.to_string())
    }
}

async fn serve<T: zbus::object_server::Interface>(bus: &PrivateBus, iface: T) -> zbus::Connection {
    let connection = bus.connect().await;
    connection
        .object_server()
        .at("/org/knivchit/ClipboardService", iface)
        .await
        .unwrap();
    connection.request_name("org.knivchit.ClipboardService").await.unwrap();
    connection
}

#[tokio::test]
async fn access_denied_means_shortcuts_unavailable_everywhere_without_a_generic_error() {
    let bus = PrivateBus::spawn();
    let _ext = serve(&bus, DenyingExtension).await;
    let client = bus.connect().await;

    // leer: sin error, como «no disponible» (la interfaz no ofrece grabar)
    let info = get_shortcuts_on(&client).await.unwrap();
    assert!(!info.extension_active && info.shortcuts.is_empty());

    let denied = Err(SHORTCUTS_UNAVAILABLE_ERROR.to_string());
    assert_eq!(set_shortcut_on(&client, "capture", "<Super>c").await, denied.clone());
    assert_eq!(check_conflicts_on(&client, "<Super>c").await, denied.map(|_: ()| vec![]));

    // grabar: estado `unavailable` con un mensaje legible, no un error
    let flag = AtomicBool::new(false);
    let r = record_shortcut_with(&client, LONG, &flag, FAST_RETRY).await.unwrap();
    assert_eq!(r.status, "unavailable");
    assert!(r.accel.is_empty());
    assert!(r.message.contains("Knivchit") && r.message.contains("ventana activa"), "{}", r.message);
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst));
}

#[tokio::test]
async fn an_immediate_busy_from_the_cooldown_is_retried_once_and_then_succeeds() {
    let bus = PrivateBus::spawn();
    let calls = Arc::new(Mutex::new(0));
    let script = Arc::new(Mutex::new(vec![("", "busy"), ("<Super>c", "ok")]));
    let _ext = serve(&bus, ScriptedRecorder(script, calls.clone())).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);

    let r = record_shortcut_with(&client, LONG, &flag, FAST_RETRY).await.unwrap();
    assert_eq!((r.status.as_str(), r.accel.as_str()), ("ok", "<Super>c"));
    assert_eq!(*calls.lock().unwrap(), 2);
}

#[tokio::test]
async fn a_persistent_busy_is_returned_as_retryable_after_a_single_retry() {
    let bus = PrivateBus::spawn();
    let calls = Arc::new(Mutex::new(0));
    let script = Arc::new(Mutex::new(vec![("", "busy")]));
    let _ext = serve(&bus, ScriptedRecorder(script, calls.clone())).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);

    let r = record_shortcut_with(&client, LONG, &flag, FAST_RETRY).await.unwrap();
    assert_eq!((r.status.as_str(), r.accel.as_str()), ("busy", ""));
    assert_eq!(*calls.lock().unwrap(), 2, "un solo reintento");
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst), "la marca se libera");
}

#[tokio::test]
async fn unavailable_from_the_extension_gets_a_readable_message() {
    let bus = PrivateBus::spawn();
    let script = Arc::new(Mutex::new(vec![("", "unavailable")]));
    let _ext = serve(&bus, ScriptedRecorder(script, Arc::new(Mutex::new(0)))).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);

    let r = record_shortcut_with(&client, LONG, &flag, FAST_RETRY).await.unwrap();
    assert_eq!(r.status, "unavailable");
    assert!(r.message.contains("ventana activa"), "{}", r.message);
}
