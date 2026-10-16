//! Conexión compartida con los portales XDG y registro de la app ante ellos.
//!
//! Los portales identifican a la app por el `app_id` que deducen del cgroup del
//! proceso. Una app lanzada desde el menú vive en `app-gnome-knivchit-<pid>.scope`
//! (app_id `knivchit`); pero ARRANCADA POR ACTIVACIÓN D-Bus (icono o atajo con
//! la app parada) vive en `dbus-:1.N-org.knivchit.App@0.service` y NO tiene
//! app_id. Con app_id, GNOME solo muestra el aviso de permiso a la app
//! ENFOCADA que sea `<app_id>.desktop`; sin él abre un diálogo aparte y el
//! permiso concedido a `knivchit` no se aplica.
//!
//! `org.freedesktop.host.portal.Registry.Register("knivchit", {})` fija el
//! app_id sea cual sea el modo de arranque. Se hace UNA vez, ANTES de la primera
//! llamada a un portal y en la MISMA conexión que usan después las peticiones
//! (por eso todas reciben `portal::connection()`).

use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::OnceCell;
use zbus::zvariant::Value;
use zbus::Connection;

/// app_id de Knivchit ante los portales (nombre de su `.desktop` sin extensión).
pub const PORTAL_APP_ID: &str = "knivchit";

const PORTAL_DESTINATION: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const REGISTRY_INTERFACE: &str = "org.freedesktop.host.portal.Registry";
/// El registro no debe retrasar nada si el portal tarda o no existe.
const REGISTER_TIMEOUT: Duration = Duration::from_secs(5);

/// Resultado del intento de registro (informativo; nunca es un error fatal).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Registration {
    /// Registrada ahora.
    Registered,
    /// El portal ya la tenía asociada a un app_id (arranque desde el menú).
    AlreadyAssociated,
    /// En un sandbox (Flatpak) el portal ya sabe quién es: no se registra.
    SkippedSandboxed,
    /// No hay portal o no contesta; las peticiones fallarán por sí solas.
    Unavailable,
}

/// `true` si el mensaje del portal dice que la conexión ya tenía app_id.
fn is_already_associated(message: &str) -> bool {
    message.to_lowercase().contains("already associated")
}

/// `true` dentro de un sandbox de Flatpak (existe `/.flatpak-info`).
fn is_sandboxed() -> bool {
    std::path::Path::new("/.flatpak-info").exists()
}

/// Llama a `Register(app_id, {})` en `connection`. Tolera el rechazo por
/// «ya asociada», la ausencia del portal y los plazos largos.
pub async fn register_on(connection: &Connection, app_id: &str, sandboxed: bool) -> Registration {
    if sandboxed {
        return Registration::SkippedSandboxed;
    }
    let call = async {
        let proxy =
            zbus::Proxy::new(connection, PORTAL_DESTINATION, PORTAL_PATH, REGISTRY_INTERFACE).await?;
        proxy
            .call_method("Register", &(app_id, HashMap::<String, Value<'_>>::new()))
            .await
            .map(|_| ())
    };
    match tokio::time::timeout(REGISTER_TIMEOUT, call).await {
        Ok(Ok(())) => Registration::Registered,
        Ok(Err(zbus::Error::MethodError(_, Some(message), _))) if is_already_associated(&message) => {
            Registration::AlreadyAssociated
        }
        Ok(Err(_)) | Err(_) => Registration::Unavailable,
    }
}

/// Conexión de portales de una sesión: se conecta y registra la primera vez
/// que se pide y devuelve siempre la misma.
#[derive(Default)]
pub struct PortalSession {
    connection: OnceCell<Option<Connection>>,
}

impl PortalSession {
    /// `connect` abre la conexión (el bus de sesión real en producción, uno
    /// privado en los tests). Dos llamadas simultáneas registran una sola vez.
    pub async fn connection_with<F>(&self, connect: F, app_id: &str, sandboxed: bool) -> Option<Connection>
    where
        F: std::future::Future<Output = zbus::Result<Connection>>,
    {
        self.connection
            .get_or_init(|| async {
                let connection = connect.await.ok()?;
                match register_on(&connection, app_id, sandboxed).await {
                    Registration::Registered | Registration::AlreadyAssociated | Registration::SkippedSandboxed => {}
                    // Sin metadatos sensibles; el portal ausente ya se verá en la petición.
                    Registration::Unavailable => eprintln!("knivchit: no se pudo registrar la app ante el portal"),
                }
                Some(connection)
            })
            .await
            .clone()
    }
}

static SESSION: PortalSession = PortalSession { connection: OnceCell::const_new() };

/// Conexión (ya registrada) que deben usar TODAS las peticiones a portales.
/// `None` solo si no hay bus de sesión; entonces ashpd usa la suya y falla
/// con su propio error.
pub async fn connection() -> Option<Connection> {
    SESSION
        .connection_with(Connection::session(), PORTAL_APP_ID, is_sandboxed())
        .await
}

/// Registra en segundo plano al arrancar, sin bloquear el arranque.
pub fn register_in_background() {
    tauri::async_runtime::spawn(async {
        let _ = connection().await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_portal_message_for_an_already_registered_connection_is_recognized() {
        assert!(is_already_associated("Connection already associated with an application ID"));
        assert!(is_already_associated("connection ALREADY ASSOCIATED with an application id"));
        assert!(!is_already_associated("Invalid app id"));
    }

    #[test]
    fn the_app_id_matches_the_desktop_file_name() {
        assert_eq!(PORTAL_APP_ID, "knivchit");
    }
}
