//! `record_shortcut` contra una extensión FALSA en un bus privado: cada
//! estado, el timeout local, `busy`, la extensión ausente y la que
//! desaparece a mitad de la grabación.

mod common;

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::commands::shortcuts::{
    record_shortcut_on, RecordedShortcut, EXTENSION_INACTIVE_ERROR,
};

#[derive(Clone)]
struct Reply {
    accel: &'static str,
    status: &'static str,
    delay_ms: u64,
}

struct FakeExtension(Arc<Mutex<Reply>>, Arc<Mutex<u32>>);

#[interface(name = "org.knivchit.ClipboardService")]
impl FakeExtension {
    async fn record_shortcut(&self) -> (String, String) {
        *self.1.lock().unwrap() += 1;
        let reply = self.0.lock().unwrap().clone();
        tokio::time::sleep(Duration::from_millis(reply.delay_ms)).await;
        (reply.accel.to_string(), reply.status.to_string())
    }
}

async fn start_fake(
    bus: &PrivateBus,
    accel: &'static str,
    status: &'static str,
    delay_ms: u64,
) -> (zbus::Connection, Arc<Mutex<u32>>) {
    let calls = Arc::new(Mutex::new(0));
    let reply = Arc::new(Mutex::new(Reply { accel, status, delay_ms }));
    let connection = bus.connect().await;
    connection
        .object_server()
        .at("/org/knivchit/ClipboardService", FakeExtension(reply, calls.clone()))
        .await
        .unwrap();
    connection.request_name("org.knivchit.ClipboardService").await.unwrap();
    (connection, calls)
}

fn got(accel: &str, status: &str) -> Result<RecordedShortcut, String> {
    Ok(RecordedShortcut {
        accel: accel.to_string(),
        status: status.to_string(),
        message: String::new(),
    })
}

const LONG: Duration = Duration::from_secs(5);

#[tokio::test]
async fn ok_delivers_the_validated_accelerator() {
    let bus = PrivateBus::spawn();
    let (_ext, _) = start_fake(&bus, "<Super><Shift>c", "ok", 0).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);
    assert_eq!(record_shortcut_on(&client, LONG, &flag).await, got("<Super><Shift>c", "ok"));
}

#[tokio::test]
async fn cancelled_timeout_busy_and_invalid_from_the_extension_carry_no_accel() {
    for status in ["cancelled", "timeout", "busy"] {
        let bus = PrivateBus::spawn();
        let (_ext, _) = start_fake(&bus, "<Super>c", status, 0).await;
        let client = bus.connect().await;
        let flag = AtomicBool::new(false);
        assert_eq!(record_shortcut_on(&client, LONG, &flag).await, got("", status), "{status}");
    }
}

#[tokio::test]
async fn an_invalid_accel_with_ok_status_is_turned_into_invalid_with_a_reason() {
    let bus = PrivateBus::spawn();
    let (_ext, _) = start_fake(&bus, "c", "ok", 0).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);
    let reply = record_shortcut_on(&client, LONG, &flag).await.unwrap();
    assert_eq!((reply.accel.as_str(), reply.status.as_str()), ("", "invalid"));
    assert!(!reply.message.is_empty());
}

#[tokio::test]
async fn invalid_from_the_extension_delivers_its_reason_as_the_message() {
    let bus = PrivateBus::spawn();
    let (_ext, _) = start_fake(&bus, "Hace falta al menos un modificador.", "invalid", 0).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);
    assert_eq!(
        record_shortcut_on(&client, LONG, &flag).await,
        Ok(RecordedShortcut {
            accel: String::new(),
            status: "invalid".into(),
            message: "Hace falta al menos un modificador.".into(),
        })
    );
}

#[tokio::test]
async fn an_unresponsive_extension_ends_in_a_local_timeout() {
    let bus = PrivateBus::spawn();
    let (_ext, _) = start_fake(&bus, "<Super>c", "ok", 5_000).await;
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);
    assert_eq!(
        record_shortcut_on(&client, Duration::from_millis(200), &flag).await,
        got("", "timeout")
    );
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst), "libera la marca al terminar");
}

#[tokio::test]
async fn a_second_recording_in_flight_is_busy_without_calling_the_extension() {
    let bus = PrivateBus::spawn();
    let (_ext, calls) = start_fake(&bus, "<Super>c", "ok", 600).await;
    let client = bus.connect().await;
    let flag = Arc::new(AtomicBool::new(false));

    let first = {
        let (client, flag) = (client.clone(), flag.clone());
        tokio::spawn(async move { record_shortcut_on(&client, LONG, &flag).await })
    };
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(record_shortcut_on(&client, LONG, &flag).await, got("", "busy"));
    assert_eq!(first.await.unwrap(), got("<Super>c", "ok"));
    assert_eq!(*calls.lock().unwrap(), 1, "la segunda no llegó a la extensión");

    // y tras terminar la primera se puede volver a grabar
    assert_eq!(record_shortcut_on(&client, LONG, &flag).await, got("<Super>c", "ok"));
}

#[tokio::test]
async fn without_the_extension_it_says_so_and_releases_the_flag() {
    let bus = PrivateBus::spawn();
    let client = bus.connect().await;
    let flag = AtomicBool::new(false);
    assert_eq!(
        record_shortcut_on(&client, LONG, &flag).await,
        Err(EXTENSION_INACTIVE_ERROR.to_string())
    );
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst));
}

#[tokio::test]
async fn an_extension_that_disappears_mid_recording_is_reported_as_inactive() {
    let bus = Arc::new(PrivateBus::spawn());
    let client = bus.connect().await;
    let flag = Arc::new(AtomicBool::new(false));

    // La extensión vive en su propio hilo y runtime: al soltar el runtime se
    // cancelan sus tareas y se cierra su socket, como al morir el proceso.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (kill_tx, kill_rx) = std::sync::mpsc::channel::<()>();
    let ext_bus = bus.clone();
    let ext_thread = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .unwrap();
        let _conn = rt.block_on(async {
            let (conn, _) = start_fake(&ext_bus, "<Super>c", "ok", 5_000).await;
            conn
        });
        ready_tx.send(()).unwrap();
        kill_rx.recv().unwrap();
        drop(rt);
    });
    ready_rx.recv().unwrap();

    let call = {
        let (client, flag) = (client.clone(), flag.clone());
        tokio::spawn(async move { record_shortcut_on(&client, LONG, &flag).await })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    kill_tx.send(()).unwrap();
    ext_thread.join().unwrap();

    assert_eq!(call.await.unwrap(), Err(EXTENSION_INACTIVE_ERROR.to_string()));
    assert!(!flag.load(std::sync::atomic::Ordering::SeqCst));
}
