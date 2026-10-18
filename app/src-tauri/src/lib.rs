pub mod capture;
pub mod capture_permission;
pub mod commands;
pub mod db;
pub mod dbus;
pub mod legacy_migration;
pub mod logging;
pub mod monitors;
pub mod navigation;
pub mod platform;
pub mod portal;

/// Fondo de las ventanas overlay y pin (`--color-chrome` oscuro, #05070D, el mismo que pinta index.html): sin él
/// el webview muestra blanco hasta pintar su primer fotograma — el «destello
/// blanco» al abrir el overlay o un pin. Ambas ventanas son siempre oscuras.
pub const WINDOW_BACKGROUND: tauri::window::Color = tauri::window::Color(5, 7, 13, 255);

use tauri::Manager;

/// Si hay que terminar el proceso cuando Tauri pide salir. `code` es `None`
/// solo cuando lo disparó el cierre de la última ventana (interacción del
/// usuario) — `Some` es un pedido explícito (`AppHandle::exit`/`restart`,
/// como el botón «Salir de Knivchit», `quit_app`) y ahí sí debe salir. Knivchit
/// es una app de segundo plano: cerrar "main" la DESTRUYE de verdad (ver `show_main_window` —
/// dejar de interceptar `CloseRequested` fue a propósito, ver esa función),
/// pero el proceso entero (servidor D-Bus `org.knivchit.App`, atajo
/// global) nunca debe morir con ella: sin este guard, cerrar la única ventana
/// mataba todo el proceso (comprobado en un Shell GNOME anidado).
fn should_prevent_exit(code: Option<i32>) -> bool {
    code.is_none()
}

/// Única vía para mostrar "main": si existe la muestra y enfoca; si el usuario la cerró, la RECREA
/// desde `tauri.conf.json` (`WebviewWindowBuilder::from_config`) y la muestra. Se usa al arrancar
/// (salvo con `--hidden`), en "Abrir Knivchit" de la bandeja y en el método D-Bus `ShowMain`;
/// nunca desde el flujo de captura.
///
/// Sin decoración nativa (bajo Wayland su ✕ no respondía), ancho fijo 480 y alto entre 480 y 720: la
/// app no consulta monitores (Wayland no tiene monitor primario) y es la extensión quien coloca la
/// ventana y recorta su alto al área útil. Cerrar "main" la destruye; el proceso sigue vivo por
/// `should_prevent_exit`. Se crea con `create: false` para respetar `--hidden` y aplicarle el filtro
/// de navegación.
pub(crate) fn show_main_window<R: tauri::Runtime, M: tauri::Manager<R>>(
    app: &M,
) -> tauri::Result<()> {
    let window = match app.get_webview_window(commands::capture_flow::MAIN_LABEL) {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == commands::capture_flow::MAIN_LABEL)
                .expect("tauri.conf.json debe declarar la ventana \"main\"")
                .clone();
            // Misma restricción de navegación que overlay y pin: "main" es la
            // ventana con más permisos y no debe poder salir del bundle.
            tauri::WebviewWindowBuilder::from_config(app, &config)?
                .on_navigation(navigation::allow_navigation)
                .build()?
        }
    };
    // Minimizada (el botón de la barra de título) `show()` no la devuelve:
    // el clic del icono de la barra superior debe traerla igualmente.
    if window.is_minimized().unwrap_or(false) {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()
}

/// Opciones de arranque tomadas de la línea de comandos.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LaunchOptions {
    /// `--hidden`: no mostrar la ventana principal al arrancar (así lo lanza
    /// la activación D-Bus del `.service`).
    pub hidden: bool,
}

/// Parsea los argumentos (incluido el nombre del binario en la posición 0).
/// Los argumentos desconocidos se ignoran.
pub fn parse_launch_options(args: impl IntoIterator<Item = String>) -> LaunchOptions {
    LaunchOptions {
        hidden: args.into_iter().skip(1).any(|a| a == "--hidden"),
    }
}

/// Qué hacer al arrancar según si ya hay una instancia viva.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StartupAction {
    /// No hay instancia: arrancar normal.
    Run,
    /// Hay instancia y el usuario quiere ver la ventana: pedírsela y salir.
    ShowExistingAndExit,
    /// Hay instancia y se lanzó con `--hidden`: no hay nada que mostrar.
    ExitSilently,
}

fn decide_startup(owner_exists: bool, options: LaunchOptions) -> StartupAction {
    match (owner_exists, options.hidden) {
        (false, _) => StartupAction::Run,
        (true, false) => StartupAction::ShowExistingAndExit,
        (true, true) => StartupAction::ExitSilently,
    }
}

/// Instancia única sin dependencia nueva: consulta por D-Bus si
/// `org.knivchit.App` tiene dueño y, si lo tiene y hace falta, llama a su
/// `ShowMain`. Devuelve `true` si este proceso debe salir (con código 0). Ante
/// cualquier fallo de D-Bus arranca normal, como antes de existir esto.
fn forward_to_running_instance(options: LaunchOptions) -> bool {
    async fn query_owner() -> zbus::Result<(zbus::Connection, bool)> {
        let connection = zbus::Connection::session().await?;
        let proxy = zbus::fdo::DBusProxy::new(&connection).await?;
        let name = zbus::names::BusName::try_from("org.knivchit.App")
            .expect("nombre de bus válido, fijo en el código");
        let owned = proxy.name_has_owner(name).await?;
        Ok((connection, owned))
    }
    async fn show_main(connection: &zbus::Connection) -> zbus::Result<()> {
        connection
            .call_method(
                Some("org.knivchit.App"),
                "/org/knivchit/App",
                Some("org.knivchit.App"),
                "ShowMain",
                &(),
            )
            .await?;
        Ok(())
    }

    let Ok((connection, owned)) = tauri::async_runtime::block_on(query_owner()) else {
        return false;
    };
    match decide_startup(owned, options) {
        StartupAction::Run => false,
        StartupAction::ExitSilently => true,
        StartupAction::ShowExistingAndExit => {
            match tauri::async_runtime::block_on(show_main(&connection)) {
                Ok(()) => true,
                Err(e) => {
                    eprintln!("knivchit: la instancia existente no respondió a ShowMain: {e}");
                    false
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let options = parse_launch_options(std::env::args());
    if forward_to_running_instance(options) {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:knivchit.db", db::migrations::migrations())
                .build(),
        )
        .setup(move |app| {
            // Registro ante los portales (app_id `knivchit`) cuanto antes y sin bloquear.
            portal::register_in_background();
            // Pool propio para el lado Rust (suscriptor D-Bus, comandos de
            // portapapeles). Solo `db/` abre SQLite.
            capture::remove_orphan_crops();
            let data_dir = app.path().app_data_dir()?;
            // Renombrado del producto: copia (sin mover) los datos del
            // identificador anterior si el nuevo aún no tiene base. Solo se
            // registran metadatos (número de archivos), nunca contenido.
            if let Some(old_dir) = legacy_migration::legacy_dir_for(&data_dir) {
                if legacy_migration::needs_migration(&old_dir, &data_dir) {
                    // Si la versión anterior sigue abierta (dueña de su nombre de bus)
                    // no se copia su base. Sin bus alcanzable se asume cerrada y
                    // la validación de la copia es la red de seguridad.
                    let old_running = tauri::async_runtime::block_on(async {
                        match zbus::Connection::session().await {
                            Ok(c) => commands::hub::name_has_owner(&c, legacy_migration::LEGACY_BUS_NAME).await,
                            Err(_) => false,
                        }
                    });
                    match legacy_migration::migrate_data_dir(&old_dir, &data_dir, old_running, |p| {
                        tauri::async_runtime::block_on(db::check_database(p))
                    }) {
                        Ok(legacy_migration::MigrationOutcome::Migrated { files }) => {
                            eprintln!("knivchit: datos migrados desde {} ({files} archivos)", legacy_migration::LEGACY_IDENTIFIER);
                        }
                        Ok(_) => {}
                        // Datos viejos inválidos: se sigue con una base nueva y los viejos quedan intactos.
                        Err(e @ legacy_migration::MigrationError::InvalidOldDatabase(_)) => {
                            eprintln!("knivchit: {}", e.user_message());
                        }
                        // Versión anterior abierta o fallo de disco: no se arranca (crear una base
                        // vacía taparía la migración para siempre); el usuario cierra la versión anterior y reabre.
                        Err(e) => {
                            let message = e.user_message();
                            eprintln!("knivchit: {message}");
                            return Err(message.into());
                        }
                    }
                }
            }
            // El directorio guarda el historial del portapapeles: 0700 si lo creamos.
            {
                use std::os::unix::fs::DirBuilderExt;
                std::fs::DirBuilder::new().recursive(true).mode(0o700).create(&data_dir)?;
            }
            let db_path = data_dir.join("knivchit.db");
            let db_url = format!("sqlite:{}?mode=rwc", db_path.display());

            let pool = tauri::async_runtime::block_on(db::open_pool(&db_url))?;
            app.manage(pool.clone());
            app.manage(commands::capture_flow::CaptureState::default());
            app.manage(commands::pin::PinState::default());
            app.manage(commands::capture_flow::CaptureActivity::default());
            app.manage(capture_permission::CapturePermission::new(&data_dir));

            // "main" se declara con `create: false` (tauri.conf.json): Tauri no la
            // crea sola, para que SIEMPRE nazca en `show_main_window` con su
            // filtro de navegación. Se muestra aquí salvo con `--hidden`
            // (activación D-Bus).
            if !options.hidden {
                let _ = show_main_window(app);
            }

            // Conecta al bus de sesión real: servidor de org.knivchit.App
            // (TogglePopup, StartCapture — los llama la extensión GNOME
            // vía atajo global) y cliente suscrito a HistoryChanged. Antes
            // de esto, ninguno de los dos lados del contrato D-Bus corría
            // fuera de los tests de integración.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let on_start_capture: std::sync::Arc<dyn Fn() + Send + Sync> = {
                    let app_handle = app_handle.clone();
                    std::sync::Arc::new(move || {
                        let app_handle = app_handle.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = commands::capture_flow::trigger_capture(&app_handle, commands::capture_access::Trigger::Shortcut).await {
                                eprintln!("knivchit: no se pudo iniciar la captura: {e}");
                            }
                        });
                    })
                };
                let on_show_main: std::sync::Arc<dyn Fn() + Send + Sync> = {
                    let app_handle = app_handle.clone();
                    std::sync::Arc::new(move || {
                        // la creación de ventanas se hace en el hilo principal
                        let main_handle = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            if let Err(e) = show_main_window(&main_handle) {
                                eprintln!("knivchit: no se pudo mostrar la ventana principal: {e}");
                            }
                        });
                    })
                };
                let service = dbus::AppService {
                    visible: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                    on_start_capture,
                    on_show_main,
                    trust: dbus::CallerTrust::enforced_for_this_process(),
                };
                let cap_count = db::get_settings(&pool)
                    .await
                    .map(|s| s.clipboard_cap_count)
                    .unwrap_or(200);
                if let Err(e) = dbus::serve_app_and_subscribe(service, pool, cap_count).await {
                    eprintln!("knivchit: no se pudo inicializar D-Bus: {e}");
                }
            });

            Ok(())
        })
        // SIN handler de `CloseRequested`: cerrar cualquier ventana (incluida
        // "main") la destruye de verdad, a propósito — ver `show_main_window`
        // para el porqué y `should_prevent_exit` para por qué eso no mata el
        // proceso entero.
        .invoke_handler(tauri::generate_handler![
            commands::capture_flow::start_capture,
            commands::capture_flow::get_capture_permission,
            commands::capture_flow::request_capture_permission,
            commands::capture_flow::get_capture_preview,
            commands::capture_flow::cancel_capture,
            commands::capture_flow::capture_activity,
            commands::output::save_capture,
            commands::output::save_capture_as,
            commands::output::copy_capture,
            commands::pin::pin_capture,
            commands::pin::get_pin_image,
            commands::pin::close_pin,
            commands::get_clipboard_history,
            commands::pin_clipboard_entry,
            commands::delete_clipboard_entry,
            commands::clear_clipboard_history,
            commands::hub::get_integration_status,
            commands::hub::choose_save_dir,
            commands::hub::open_save_dir,
            commands::hub::get_default_save_dir,
            commands::hub::get_autostart,
            commands::hub::set_autostart,
            commands::shortcuts::get_shortcuts,
            commands::shortcuts::set_shortcut,
            commands::shortcuts::check_shortcut_conflicts,
            commands::shortcuts::record_shortcut,
            commands::quit::quit_app,
            commands::panel_icon::get_panel_icon,
            commands::panel_icon::set_panel_icon,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::update::check_for_update,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if should_prevent_exit(code) {
                    api.prevent_exit();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_and_pin_background_is_opaque_and_dark_never_white() {
        let tauri::window::Color(r, g, b, a) = WINDOW_BACKGROUND;
        assert!(r < 40 && g < 40 && b < 60, "oscuro (#05070D)");
        assert_eq!(a, 255);
    }

    #[test]
    fn only_the_implicit_last_window_exit_is_prevented() {
        assert!(should_prevent_exit(None), "cierre de la última ventana");
        assert!(!should_prevent_exit(Some(0)), "\"Salir\" del menú de bandeja");
        assert!(!should_prevent_exit(Some(1)), "AppHandle::exit explícito");
    }

    #[test]
    fn hidden_flag_is_parsed_from_args_ignoring_the_binary_name() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(!parse_launch_options(args(&["knivchit"])).hidden);
        assert!(parse_launch_options(args(&["knivchit", "--hidden"])).hidden);
        assert!(parse_launch_options(args(&["knivchit", "--otro", "--hidden"])).hidden);
        assert!(!parse_launch_options(args(&["knivchit", "--hidden-no"])).hidden);
        assert!(!parse_launch_options(args(&["--hidden"])).hidden, "la posición 0 es el binario");
    }

    #[test]
    fn startup_forwards_to_a_running_instance_only_when_one_exists() {
        let shown = LaunchOptions { hidden: false };
        let hidden = LaunchOptions { hidden: true };
        assert_eq!(decide_startup(false, shown), StartupAction::Run);
        assert_eq!(decide_startup(false, hidden), StartupAction::Run);
        assert_eq!(decide_startup(true, shown), StartupAction::ShowExistingAndExit);
        assert_eq!(decide_startup(true, hidden), StartupAction::ExitSilently);
    }

    // LIMITACIÓN: `tauri::test::mock_context` siempre arma una `Config` con
    // `app.windows` vacío y ese campo es `pub(crate)` dentro de `tauri` — no
    // hay forma, desde este crate, de declararle una ventana "main" al
    // contexto de prueba. Por eso la rama de `show_main_window` que RECREA la
    // ventana (`WebviewWindowBuilder::from_config`) no se puede ejercitar con
    // `MockRuntime`; solo la rama "ya existe" queda cubierta acá. La
    // recreación se confirma a mano en un GNOME real (ver verificación de
    // "gnome" pendiente).
    #[test]
    fn show_main_window_reuses_it_when_it_already_exists() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        tauri::WebviewWindowBuilder::new(
            &app,
            commands::capture_flow::MAIN_LABEL,
            Default::default(),
        )
        .build()
        .unwrap();

        assert!(show_main_window(&app).is_ok());
        assert!(app
            .get_webview_window(commands::capture_flow::MAIN_LABEL)
            .is_some());
    }
}
