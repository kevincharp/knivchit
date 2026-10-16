//! Registro de la app ante los portales (`Registry.Register("knivchit")`)
//! contra un portal FALSO en un bus privado: ocurre una vez, antes de la
//! primera petición y en la misma conexión; el rechazo por «ya asociada» y la
//! ausencia del portal se toleran sin bloquear.

mod common;

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use zbus::interface;

use common::private_bus::PrivateBus;
use knivchit_lib::portal::{register_on, PortalSession, Registration, PORTAL_APP_ID};

type Log = Arc<Mutex<Vec<String>>>;

struct Registry(Log, Option<&'static str>);

#[interface(name = "org.freedesktop.host.portal.Registry")]
impl Registry {
    async fn register(
        &self,
        app_id: String,
        _options: std::collections::HashMap<String, zbus::zvariant::OwnedValue>,
    ) -> zbus::fdo::Result<()> {
        self.0.lock().unwrap().push(format!("Register({app_id})"));
        match self.1 {
            Some(message) => Err(zbus::fdo::Error::Failed(message.to_string())),
            None => Ok(()),
        }
    }
}

struct Screenshot(Log);

#[interface(name = "org.freedesktop.portal.Screenshot")]
impl Screenshot {
    async fn ping(&self) {
        self.0.lock().unwrap().push("Screenshot".to_string());
    }
}

async fn fake_portal(bus: &PrivateBus, register_error: Option<&'static str>) -> (zbus::Connection, Log) {
    let log: Log = Arc::default();
    let conn = bus.connect().await;
    let objects = conn.object_server();
    objects.at("/org/freedesktop/portal/desktop", Registry(log.clone(), register_error)).await.unwrap();
    objects.at("/org/freedesktop/portal/desktop", Screenshot(log.clone())).await.unwrap();
    conn.request_name("org.freedesktop.portal.Desktop").await.unwrap();
    (conn, log)
}

async fn call_portal(conn: &zbus::Connection) {
    conn.call_method(
        Some("org.freedesktop.portal.Desktop"),
        "/org/freedesktop/portal/desktop",
        Some("org.freedesktop.portal.Screenshot"),
        "Ping",
        &(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn registers_the_app_id_before_the_first_portal_request_on_the_same_connection() {
    let bus = PrivateBus::spawn();
    let (_portal, log) = fake_portal(&bus, None).await;
    let session = PortalSession::default();

    let conn = session.connection_with(async { Ok(bus.connect().await) }, PORTAL_APP_ID, false).await.unwrap();
    call_portal(&conn).await;
    // una segunda petición reutiliza la conexión y no vuelve a registrar
    let again = session.connection_with(async { Ok(bus.connect().await) }, PORTAL_APP_ID, false).await.unwrap();
    call_portal(&again).await;

    assert_eq!(*log.lock().unwrap(), ["Register(knivchit)", "Screenshot", "Screenshot"]);
    assert_eq!(conn.unique_name(), again.unique_name(), "la misma conexión para todas las peticiones");
}

#[tokio::test]
async fn simultaneous_first_requests_register_once() {
    let bus = Arc::new(PrivateBus::spawn());
    let (_portal, log) = fake_portal(&bus, None).await;
    let session = Arc::new(PortalSession::default());
    let tasks: Vec<_> = (0..4)
        .map(|_| {
            let (session, bus) = (session.clone(), bus.clone());
            tokio::spawn(async move {
                session.connection_with(async { Ok(bus.connect().await) }, PORTAL_APP_ID, false).await.is_some()
            })
        })
        .collect();
    for t in tasks {
        assert!(t.await.unwrap());
    }
    assert_eq!(*log.lock().unwrap(), ["Register(knivchit)"]);
}

#[tokio::test]
async fn a_connection_that_already_has_an_app_id_is_tolerated() {
    let bus = PrivateBus::spawn();
    let (_portal, log) = fake_portal(&bus, Some("Connection already associated with an application ID")).await;
    let client = bus.connect().await;
    assert_eq!(register_on(&client, PORTAL_APP_ID, false).await, Registration::AlreadyAssociated);

    // y la sesión sigue funcionando
    let session = PortalSession::default();
    let conn = session.connection_with(async { Ok(client) }, PORTAL_APP_ID, false).await.unwrap();
    call_portal(&conn).await;
    assert_eq!(log.lock().unwrap().last().unwrap(), "Screenshot");
}

#[tokio::test]
async fn any_other_rejection_is_not_fatal_either() {
    let bus = PrivateBus::spawn();
    let (_portal, _log) = fake_portal(&bus, Some("app id no válido")).await;
    let client = bus.connect().await;
    assert_eq!(register_on(&client, PORTAL_APP_ID, false).await, Registration::Unavailable);
}

#[tokio::test]
async fn inside_a_sandbox_nothing_is_registered() {
    let bus = PrivateBus::spawn();
    let (_portal, log) = fake_portal(&bus, None).await;
    let client = bus.connect().await;
    assert_eq!(register_on(&client, PORTAL_APP_ID, true).await, Registration::SkippedSandboxed);
    assert!(log.lock().unwrap().is_empty());
}

#[tokio::test]
async fn without_a_portal_it_returns_quickly_and_still_hands_out_the_connection() {
    let bus = PrivateBus::spawn();
    let started = Instant::now();
    let session = PortalSession::default();
    let conn = session.connection_with(async { Ok(bus.connect().await) }, PORTAL_APP_ID, false).await;
    assert!(conn.is_some(), "las peticiones fallarán por sí solas, el arranque no");
    assert!(started.elapsed() < Duration::from_secs(4), "no espera al plazo completo");
}

#[tokio::test]
async fn an_unreachable_bus_gives_none_not_a_panic() {
    let session = PortalSession::default();
    let conn = session
        .connection_with(async { Err(zbus::Error::Failure("sin bus".into())) }, PORTAL_APP_ID, false)
        .await;
    assert!(conn.is_none());
}
