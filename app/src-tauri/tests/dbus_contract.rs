mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use common::private_bus::PrivateBus;
use knivchit_lib::dbus::{AppService, CallerTrust};

#[tokio::test]
async fn toggle_popup_flips_visibility_state() {
    let bus = PrivateBus::spawn();
    let visible = Arc::new(AtomicBool::new(false));
    let service = AppService {
        visible: visible.clone(),
        on_start_capture: Arc::new(|| {}),
        on_show_main: Arc::new(|| {}),
        trust: CallerTrust::AllowAny,
    };

    let server_conn = bus.connect().await;
    server_conn
        .object_server()
        .at("/org/knivchit/App", service)
        .await
        .expect("failed to register the org.knivchit.App object");
    server_conn
        .request_name("org.knivchit.App")
        .await
        .expect("failed to request org.knivchit.App on the private session bus");

    let client_conn = bus.connect().await;
    let proxy = zbus::Proxy::new(
        &client_conn,
        "org.knivchit.App",
        "/org/knivchit/App",
        "org.knivchit.App",
    )
    .await
    .unwrap();

    assert!(!visible.load(Ordering::SeqCst));

    proxy.call_method("TogglePopup", &()).await.unwrap();
    assert!(
        visible.load(Ordering::SeqCst),
        "expected visible=true after first TogglePopup"
    );

    proxy.call_method("TogglePopup", &()).await.unwrap();
    assert!(
        !visible.load(Ordering::SeqCst),
        "expected visible=false after second TogglePopup (toggle, not always-on)"
    );
}

#[tokio::test]
async fn start_capture_dbus_method_invokes_the_callback() {
    let bus = PrivateBus::spawn();
    let called = Arc::new(AtomicBool::new(false));
    let called_clone = called.clone();
    let service = AppService {
        visible: Arc::new(AtomicBool::new(false)),
        on_start_capture: Arc::new(move || called_clone.store(true, Ordering::SeqCst)),
        on_show_main: Arc::new(|| {}),
        trust: CallerTrust::AllowAny,
    };

    let server_conn = bus.connect().await;
    server_conn
        .object_server()
        .at("/org/knivchit/App", service)
        .await
        .expect("failed to register the org.knivchit.App.StartCaptureTest object");
    server_conn
        .request_name("org.knivchit.App.StartCaptureTest")
        .await
        .expect("failed to request org.knivchit.App.StartCaptureTest on the private session bus");

    let client_conn = bus.connect().await;
    let proxy = zbus::Proxy::new(
        &client_conn,
        "org.knivchit.App.StartCaptureTest",
        "/org/knivchit/App",
        "org.knivchit.App",
    )
    .await
    .unwrap();

    assert!(!called.load(Ordering::SeqCst));
    proxy.call_method("StartCapture", &()).await.unwrap();
    assert!(
        called.load(Ordering::SeqCst),
        "expected StartCapture to invoke the on_start_capture callback"
    );
}

#[tokio::test]
async fn show_main_dbus_method_invokes_the_callback() {
    let called = Arc::new(AtomicBool::new(false));
    let called_clone = called.clone();
    let service = AppService {
        visible: Arc::new(AtomicBool::new(false)),
        on_start_capture: Arc::new(|| {}),
        on_show_main: Arc::new(move || called_clone.store(true, Ordering::SeqCst)),
        trust: CallerTrust::AllowAny,
    };

    let bus = PrivateBus::spawn();
    let server_conn = bus.connect().await;
    server_conn
        .object_server()
        .at("/org/knivchit/App", service)
        .await
        .expect("failed to register the org.knivchit.App.ShowMainTest object");
    server_conn
        .request_name("org.knivchit.App.ShowMainTest")
        .await
        .expect("failed to request org.knivchit.App.ShowMainTest on the private session bus");

    let client_conn = bus.connect().await;
    let proxy = zbus::Proxy::new(
        &client_conn,
        "org.knivchit.App.ShowMainTest",
        "/org/knivchit/App",
        "org.knivchit.App",
    )
    .await
    .unwrap();

    assert!(!called.load(Ordering::SeqCst));
    proxy.call_method("ShowMain", &()).await.unwrap();
    assert!(
        called.load(Ordering::SeqCst),
        "expected ShowMain to invoke the on_show_main callback"
    );
}

// ------------------------------------------- autenticación del llamante (BE-03)
// Estas pruebas usan las credenciales REALES que da el daemon del bus: el
// «llamante» es este mismo binario de test.

async fn enforced_proxy(
    bus: &PrivateBus,
    name: &str,
    trust: CallerTrust,
    called: Arc<AtomicBool>,
) -> zbus::Proxy<'static> {
    let (c1, c2) = (called.clone(), called);
    let service = AppService {
        visible: Arc::new(AtomicBool::new(false)),
        on_start_capture: Arc::new(move || c1.store(true, Ordering::SeqCst)),
        on_show_main: Arc::new(move || c2.store(true, Ordering::SeqCst)),
        trust,
    };
    let server_conn = bus.connect().await;
    server_conn.object_server().at("/org/knivchit/App", service).await.unwrap();
    server_conn.request_name(name.to_string()).await.unwrap();
    // la conexión del servidor debe seguir viva mientras dura el test
    std::mem::forget(server_conn);
    let client_conn = bus.connect().await;
    zbus::Proxy::new(&client_conn, name.to_string(), "/org/knivchit/App", "org.knivchit.App")
        .await
        .unwrap()
}

fn this_process() -> (u32, String) {
    use std::os::unix::fs::MetadataExt;
    let uid = std::fs::metadata("/proc/self").unwrap().uid();
    let exe = knivchit_lib::dbus::exe_name_of(&std::env::current_exe().unwrap()).unwrap();
    (uid, exe)
}

#[tokio::test]
async fn enforced_denies_start_capture_from_a_process_that_is_not_gnome_shell() {
    let bus = PrivateBus::spawn();
    let called = Arc::new(AtomicBool::new(false));
    let (my_uid, _) = this_process();
    let trust = CallerTrust::Enforced { my_uid, my_exe_name: "knivchit".into() };
    let proxy = enforced_proxy(&bus, "org.knivchit.App.DenyTest", trust, called.clone()).await;

    let err = proxy.call_method("StartCapture", &()).await.unwrap_err();
    assert!(err.to_string().contains("AccessDenied"), "{err}");
    assert!(!called.load(Ordering::SeqCst), "el callback no debe ejecutarse");
}

#[tokio::test]
async fn enforced_denies_show_main_from_another_user_or_another_binary() {
    let bus = PrivateBus::spawn();
    let (my_uid, exe) = this_process();
    for (name, trust) in [
        (
            "org.knivchit.App.WrongUid",
            CallerTrust::Enforced { my_uid: my_uid + 1, my_exe_name: exe.clone() },
        ),
        (
            "org.knivchit.App.WrongExe",
            CallerTrust::Enforced { my_uid, my_exe_name: "otro-binario".into() },
        ),
    ] {
        let called = Arc::new(AtomicBool::new(false));
        let proxy = enforced_proxy(&bus, name, trust, called.clone()).await;
        assert!(proxy.call_method("ShowMain", &()).await.is_err(), "{name}");
        assert!(!called.load(Ordering::SeqCst), "{name}");
    }
}

#[tokio::test]
async fn enforced_allows_show_main_from_the_same_user_and_binary() {
    let bus = PrivateBus::spawn();
    let called = Arc::new(AtomicBool::new(false));
    let (my_uid, exe) = this_process();
    let trust = CallerTrust::Enforced { my_uid, my_exe_name: exe };
    let proxy = enforced_proxy(&bus, "org.knivchit.App.AllowTest", trust, called.clone()).await;

    proxy.call_method("ShowMain", &()).await.unwrap();
    assert!(called.load(Ordering::SeqCst));
}
