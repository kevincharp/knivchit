/// Comandos propios expuestos al webview. Con `AppManifest` Tauri deja de
/// permitirlos a TODA ventana: cada capability concede los suyos con
/// `allow-<comando-con-guiones>`. `tests/command_registry.rs` comprueba que
/// esta lista, `generate_handler!` y las capabilities coinciden.
const APP_COMMANDS: &[&str] = &[
    "start_capture",
    "get_capture_permission",
    "request_capture_permission",
    "get_capture_preview",
    "cancel_capture",
    "capture_activity",
    "save_capture",
    "save_capture_as",
    "copy_capture",
    "pin_capture",
    "get_pin_image",
    "close_pin",
    "get_clipboard_history",
    "pin_clipboard_entry",
    "delete_clipboard_entry",
    "clear_clipboard_history",
    "get_integration_status",
    "choose_save_dir",
    "open_save_dir",
    "get_autostart",
    "set_autostart",
    "get_shortcuts",
    "set_shortcut",
    "check_shortcut_conflicts",
    "record_shortcut",
    "quit_app",
    "get_panel_icon",
    "set_panel_icon",
    "get_settings",
    "update_settings",
    "check_for_update",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("error al generar los permisos de la app");
}
