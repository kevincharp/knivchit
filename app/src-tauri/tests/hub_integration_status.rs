//! `name_has_owner` contra un bus de sesión PRIVADO (`PrivateBus`), nunca el
//! real: los tests del contrato D-Bus nunca tocan el bus de la máquina.

mod common;

use common::private_bus::PrivateBus;

use knivchit_lib::commands::hub::name_has_owner;

#[tokio::test]
async fn name_has_owner_reflects_whether_a_name_is_taken() {
    let bus = PrivateBus::spawn();
    let connection = bus.connect().await;
    let name = format!("org.knivchit.HubTest{}", std::process::id());

    assert!(!name_has_owner(&connection, &name).await);
    connection.request_name(name.as_str()).await.unwrap();
    assert!(name_has_owner(&connection, &name).await);
}

#[tokio::test]
async fn an_invalid_bus_name_is_reported_as_no_owner_without_panicking() {
    let bus = PrivateBus::spawn();
    let connection = bus.connect().await;
    assert!(!name_has_owner(&connection, "no es un nombre").await);
}
