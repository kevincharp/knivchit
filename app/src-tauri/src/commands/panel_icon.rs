//! Icono opcional de Knivchit en la barra superior de GNOME. Lo dibuja la
//! EXTENSIÓN (un clic en él pide `ShowMain` a la app); la preferencia vive en
//! el GSettings de la extensión, no en SQLite. La app solo la lee y la cambia
//! por D-Bus (`org.knivchit.ClipboardService`: `GetPanelIcon` -> `b`,
//! `SetPanelIcon(b)` -> `(b, s)`), con el mismo manejo de errores que los
//! atajos: extensión inactiva, `AccessDenied` («no disponible») y extensión
//! antigua.

use serde::Serialize;
use zbus::{proxy, Connection};

use super::hub::name_has_owner;
use super::shortcuts::{
    bounded_remote_error, call_error, is_access_denied, session, EXTENSION_BUS_NAME,
    EXTENSION_INACTIVE_ERROR,
};

#[proxy(
    interface = "org.knivchit.ClipboardService",
    default_service = "org.knivchit.ClipboardService",
    default_path = "/org/knivchit/ClipboardService"
)]
trait ExtensionPanelIcon {
    fn get_panel_icon(&self) -> zbus::Result<bool>;
    fn set_panel_icon(&self, enabled: bool) -> zbus::Result<(bool, String)>;
}

/// `extension_active: false` cubre extensión ausente y `AccessDenied`: el hub
/// desactiva el interruptor. `enabled` solo significa algo si está activa.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct PanelIconInfo {
    pub extension_active: bool,
    pub enabled: bool,
}

const NOT_AVAILABLE: PanelIconInfo = PanelIconInfo { extension_active: false, enabled: false };

pub async fn get_panel_icon_on(connection: &Connection) -> Result<PanelIconInfo, String> {
    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Ok(NOT_AVAILABLE);
    }
    let proxy = ExtensionPanelIconProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    match proxy.get_panel_icon().await {
        Ok(enabled) => Ok(PanelIconInfo { extension_active: true, enabled }),
        Err(e) if is_access_denied(&e) => Ok(NOT_AVAILABLE),
        Err(e) => Err(call_error(&e, "no se pudo leer el icono de la barra superior")),
    }
}

pub async fn set_panel_icon_on(connection: &Connection, enabled: bool) -> Result<(), String> {
    if !name_has_owner(connection, EXTENSION_BUS_NAME).await {
        return Err(EXTENSION_INACTIVE_ERROR.to_string());
    }
    let proxy = ExtensionPanelIconProxy::new(connection)
        .await
        .map_err(|_| "no se pudo conectar con la extensión".to_string())?;
    let (ok, error) = proxy
        .set_panel_icon(enabled)
        .await
        .map_err(|e| call_error(&e, "no se pudo cambiar el icono de la barra superior"))?;
    if ok {
        Ok(())
    } else {
        Err(bounded_remote_error(&error))
    }
}

/// `{ extension_active, enabled }`. Sin extensión o rechazada: `extension_active:
/// false` y sin error. Extensión antigua: Err `"extension_outdated"`.
#[tauri::command]
pub async fn get_panel_icon() -> Result<PanelIconInfo, String> {
    get_panel_icon_on(&session().await?).await
}

/// Muestra u oculta el icono. Err `"extension_inactive"` sin extensión,
/// `"shortcuts_unavailable"` si la extensión rechaza a la app y
/// `"extension_outdated"` con una extensión antigua.
#[tauri::command]
pub async fn set_panel_icon(enabled: bool) -> Result<(), String> {
    set_panel_icon_on(&session().await?, enabled).await
}
