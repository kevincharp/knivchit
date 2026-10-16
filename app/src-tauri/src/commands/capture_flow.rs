use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::capture::{self, PortalFailure};
use crate::capture_permission::{CaptureErrorCode, CapturePermission, CapturePermissionState};
use super::capture_access::{acquire_photo, request_permission, CaptureEnv, Trigger};
use crate::monitors::{self, CaptureOutcome, CropRect, IdleWatch, MonitorGeom, OverlayWatch};

pub(crate) const OVERLAY_LABEL: &str = "capture-overlay";
const OVERLAY_TITLE: &str = "knivchit-capture-overlay";
const OVERLAY_TIMEOUT_MS: u64 = 5000;
/// Última defensa: un overlay con la captura aún pendiente y SIN actividad
/// del frontend (`capture_activity`) durante este tiempo se cancela solo.
/// Ajustar aquí si resulta corto o largo.
const OVERLAY_IDLE_TIMEOUT_MS: u64 = 60_000;
const IDLE_POLL_MS: u64 = 1000;

/// Dos pedidos de captura con menos de esto entre sí son uno solo: el segundo
/// se ignora. Solo cubre rebotes casi simultáneos (atajo disparado dos veces,
/// doble clic): un duplicado «a los pocos segundos» lo paran las guardas de
/// captura en curso y de overlay abierto, y una captura nueva legítima (Esc y
/// volver a pulsar) no debe perderse.
pub const CAPTURE_DEBOUNCE: std::time::Duration = std::time::Duration::from_secs(1);

/// Por qué se ignora un pedido de captura.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// Otra captura sigue en su fase de foto/overlay.
    InProgress,
    /// Ya hay una ventana overlay abierta.
    OverlayOpen,
    /// El pedido anterior fue hace menos de `CAPTURE_DEBOUNCE`.
    TooSoon,
}

impl SkipReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InProgress => "otra captura en curso",
            Self::OverlayOpen => "overlay ya abierto",
            Self::TooSoon => "pedido repetido demasiado pronto",
        }
    }
}

/// Generación de la captura en curso y su última actividad; el vigilante de
/// inactividad de una captura anterior se retira al ver otra generación.
/// También lleva la guarda idempotente (`try_begin`) y un contador de capturas
/// para el diagnóstico (solo metadatos, nunca contenido).
pub struct CaptureActivity(Mutex<ActivityInner>);

struct ActivityInner {
    generation: u64,
    last: std::time::Instant,
    running: bool,
    last_started: Option<std::time::Instant>,
    /// Pedidos aceptados desde que arrancó la app.
    started: u64,
    /// Pedidos ignorados por la guarda.
    skipped: u64,
}

impl Default for CaptureActivity {
    fn default() -> Self {
        Self(Mutex::new(ActivityInner {
            generation: 0,
            last: std::time::Instant::now(),
            running: false,
            last_started: None,
            started: 0,
            skipped: 0,
        }))
    }
}

impl CaptureActivity {
    /// Acepta o ignora un pedido de captura en el instante `now`. `overlay_open`:
    /// ya existe la ventana overlay. Si se acepta, devuelve `(generación, nº de
    /// captura)` y marca la captura como en curso hasta `end`.
    pub fn try_begin_at(
        &self,
        now: std::time::Instant,
        overlay_open: bool,
    ) -> Result<(u64, u64), (SkipReason, u64)> {
        let mut g = self.0.lock().unwrap();
        let reason = if g.running {
            Some(SkipReason::InProgress)
        } else if overlay_open {
            Some(SkipReason::OverlayOpen)
        } else if g.last_started.is_some_and(|t| now.saturating_duration_since(t) < CAPTURE_DEBOUNCE) {
            Some(SkipReason::TooSoon)
        } else {
            None
        };
        if let Some(reason) = reason {
            g.skipped += 1;
            return Err((reason, g.skipped));
        }
        g.running = true;
        g.last_started = Some(now);
        g.started += 1;
        g.generation += 1;
        g.last = now;
        Ok((g.generation, g.started))
    }

    /// Fin de la fase de foto/overlay de la captura en curso.
    fn end(&self) {
        self.0.lock().unwrap().running = false;
    }

    fn touch(&self) {
        self.0.lock().unwrap().last = std::time::Instant::now();
    }
    fn snapshot(&self) -> (u64, u64) {
        let g = self.0.lock().unwrap();
        (g.generation, g.last.elapsed().as_millis() as u64)
    }
}

/// Libera la marca «en curso» al terminar `trigger_capture`, también ante un
/// error o si la tarea se cancela.
struct RunningGuard(AppHandle);

impl Drop for RunningGuard {
    fn drop(&mut self) {
        self.0.state::<CaptureActivity>().end();
    }
}

/// Punto de cierre de la captura en curso. Decisión de producto tras la
/// pruebas manuales: "main" es solo la ventana de ajustes y
/// NUNCA debe reaparecer sola por una captura, sea cual sea el desenlace —
/// antes se restauraba si había estado visible, y eso hacía aparecer la
/// ventana de ajustes sin sentido al copiar o guardar. Si estaba visible,
/// `trigger_capture` ya la ocultó al empezar (ver `hide_and_capture`) y se
/// queda así; no hay nada que hacer acá. La firma queda igual a propósito:
/// los 8 call sites (acá, `output.rs`, `pin.rs`) documentan con qué
/// desenlace terminó cada captura, información real del flujo aunque ya no
/// dispare ningún efecto en este punto.
pub fn finish_capture_ui<R: Runtime>(_app: &AppHandle<R>, _outcome: CaptureOutcome) {}

/// El frontend la llama ante cualquier interacción (ratón, teclado,
/// selección) para reiniciar el contador de inactividad.
#[tauri::command]
pub fn capture_activity(state: State<'_, CaptureActivity>) {
    state.touch();
}

/// Ruta de la captura de pantalla completa pendiente de recorte — vive
/// mientras la ventana overlay está abierta, se consume en `save_capture`,
/// `copy_capture` o `pin_capture`, o se descarta en `cancel_capture`.
#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<PathBuf>>);

pub(crate) const MAIN_LABEL: &str = "main";

/// Toma una captura de pantalla completa (sin picker nativo, ver
/// `capture::capture_full_screen`) y abre la ventana overlay donde el
/// usuario dibuja su propia selección encima de esa foto congelada.
///
/// Oculta la ventana principal antes de capturar — si no, la foto congelada
/// incluye a Knivchit mismo (se veía en la primera prueba real). El delay
/// le da tiempo al compositor a repintar sin ella antes de pedir la captura.
///
/// Es una función libre (no un `#[tauri::command]`) para que tanto el botón
/// de la UI como el atajo global disparado desde D-Bus (ver `dbus::AppService`)
/// puedan llamarla sin pasar por el mecanismo de IPC de Tauri.
pub async fn trigger_capture(app: &AppHandle, trigger: Trigger) -> Result<(), String> {
    let overlay_open = app.get_webview_window(OVERLAY_LABEL).is_some();
    let (generation, number) = match app
        .state::<CaptureActivity>()
        .try_begin_at(std::time::Instant::now(), overlay_open)
    {
        Ok(started) => started,
        Err((reason, skipped)) => {
            // Solo metadatos: nunca contenido.
            eprintln!(
                "knivchit: pedido de captura ignorado ({}); ignorados hasta ahora: {skipped}",
                reason.as_str()
            );
            return Ok(());
        }
    };
    let _running = RunningGuard(app.clone());
    eprintln!("knivchit: captura #{number} iniciada ({} ms desde la época)", unix_millis());
    let env = AppEnv { app: app.clone() };

    // Desde aquí la ventana principal puede estar oculta. Si algo falla se
    // vuelve a mostrar (el usuario tiene que ver el motivo); con éxito no se
    // restaura sola (ver `finish_capture_ui`).
    let result = match acquire_photo(&env, trigger).await {
        Ok(photo) => run_capture(app, generation, photo).await,
        Err(code) => Err(code.as_str().to_string()),
    };
    if result.is_err() {
        show_main_now(app);
        finish_capture_ui(app, CaptureOutcome::Error);
    }
    result
}

/// Muestra la ventana principal (la crea si hace falta) en el hilo principal.
fn show_main_now(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(e) = crate::show_main_window(&handle) {
            eprintln!("knivchit: no se pudo mostrar la ventana principal: {e}");
        }
    });
}

/// Evento hacia la ventana principal con el estado del permiso de captura.
pub const CAPTURE_PERMISSION_EVENT: &str = "capture-permission-changed";

/// Implementación real de `CaptureEnv`: ventanas de Tauri y portal XDG.
pub struct AppEnv {
    pub app: AppHandle,
}

impl AppEnv {
    fn permission(&self) -> tauri::State<'_, CapturePermission> {
        self.app.state::<CapturePermission>()
    }
}

impl CaptureEnv for AppEnv {
    fn granted(&self) -> bool {
        self.permission().granted()
    }

    fn set_granted(&self, granted: bool) {
        if let Err(e) = self.permission().set_granted(granted) {
            // Sin contenido: solo el tipo de error.
            eprintln!("knivchit: no se pudo guardar el permiso de captura ({:?})", e.kind());
        }
    }

    fn record(&self, error: Option<CaptureErrorCode>) {
        let permission = self.permission();
        permission.record_error(error);
        let _ = self.app.emit_to(MAIN_LABEL, CAPTURE_PERMISSION_EVENT, permission.state());
        if let Some(code) = error {
            eprintln!("knivchit: captura sin éxito ({})", code.as_str());
        }
    }

    async fn show_main_focused(&self) {
        show_main_now(&self.app);
        // Espera acotada a tener el foco: GNOME solo muestra su aviso de permiso
        // a la app enfocada. Si el Shell no lo concede, se sigue igualmente.
        let started = std::time::Instant::now();
        while started.elapsed() < MAIN_FOCUS_MAX_WAIT {
            let focused = self
                .app
                .get_webview_window(MAIN_LABEL)
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false);
            if focused {
                return;
            }
            tokio::time::sleep(MAIN_FOCUS_POLL).await;
        }
    }

    async fn hide_main_and_settle(&self) {
        let Some(main) = self.app.get_webview_window(MAIN_LABEL).filter(|m| m.is_visible().unwrap_or(false)) else {
            return;
        };
        let _ = main.hide();
        // Espera a que deje de estar visible (determinista) y luego al desmapeo
        // animado del compositor. Con «main» oculta o cerrada no se espera nada.
        let started = std::time::Instant::now();
        while main.is_visible().unwrap_or(false) && started.elapsed() < MAIN_HIDE_MAX_WAIT {
            tokio::time::sleep(MAIN_HIDE_POLL).await;
        }
        tokio::time::sleep(MAIN_HIDE_SETTLE).await;
    }

    async fn photo(&self, with_parent: bool) -> Result<PathBuf, PortalFailure> {
        let parent = if with_parent {
            capture::parent_identifier(&self.app, MAIN_LABEL).await
        } else {
            None
        };
        let result = capture::capture_full_screen(parent).await?;
        capture::uri_to_path(&result.uri).map_err(|_| PortalFailure::Unavailable)
    }

    fn discard(&self, photo: &Path) {
        capture::remove_portal_original(photo);
    }
}

const MAIN_FOCUS_POLL: std::time::Duration = std::time::Duration::from_millis(50);
const MAIN_FOCUS_MAX_WAIT: std::time::Duration = std::time::Duration::from_millis(1500);

fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Tras ocultar «main» el compositor aún tarda en retirarla de pantalla (la
/// animación de desmapeo de GNOME dura ~150–250 ms): `is_visible()` ya dice
/// `false`, pero la ventana sigue pintada unos fotogramas. Pedir la foto antes
/// la deja DENTRO de la captura. Solo hace falta esperar si «main» estaba visible.
const MAIN_HIDE_SETTLE: std::time::Duration = std::time::Duration::from_millis(350);
const MAIN_HIDE_POLL: std::time::Duration = std::time::Duration::from_millis(20);
const MAIN_HIDE_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

async fn run_capture(app: &AppHandle, generation: u64, portal_path: PathBuf) -> Result<(), String> {
    // El portal devuelve UNA imagen de todo el escritorio y el overlay
    // fullscreen cubre un solo monitor: se recorta al monitor bajo el cursor.
    // La copia propia (temporal 0600) reemplaza al original: el archivo que
    // el portal dejó en la carpeta del usuario se borra siempre, también si
    // el recorte falla.
    let picked = pick_target_monitor(app, &portal_path);
    capture::remove_portal_original(&portal_path);
    let (pending_path, target) = picked?;
    let state = app.state::<CaptureState>();
    *state.0.lock().map_err(|e| e.to_string())? = Some(pending_path);

    if let Err(e) = show_or_create_overlay(app, target) {
        discard_pending(app);
        return Err(e);
    }
    wait_for_overlay(app).await?;
    focus_overlay(app);
    let watcher = app.clone();
    tauri::async_runtime::spawn(async move { watch_idle(watcher, generation).await });
    Ok(())
}

/// Da foco al overlay desde Rust: `set_focus` de Tauri y, en el hilo
/// principal, `present()` del toplevel GTK y `grab_focus` del widget del
/// webview (Mutter puede mapear la ventana sin foco de teclado en el DOM).
/// Se repite tras un instante porque el webview puede reclamar foco al
/// terminar de cargar. SIN VERIFICAR en un GNOME real.
fn focus_overlay(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else { return };
    let apply = |window: &WebviewWindow| {
        let _ = window.set_focus();
        let _ = window.with_webview(|platform| {
            use gtk::prelude::*;
            let webview = platform.inner();
            if let Some(top) = webview.toplevel().and_then(|t| t.downcast::<gtk::Window>().ok()) {
                top.present();
            }
            webview.grab_focus();
        });
    };
    apply(&window);
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        apply(&window);
    });
}

/// Vigila la inactividad de la captura `generation`; ver
/// `OVERLAY_IDLE_TIMEOUT_MS`.
async fn watch_idle(app: AppHandle, generation: u64) {
    loop {
        tokio::time::sleep(std::time::Duration::from_millis(IDLE_POLL_MS)).await;
        let (current, idle_ms) = app.state::<CaptureActivity>().snapshot();
        if current != generation {
            return;
        }
        let pending = app
            .state::<CaptureState>()
            .0
            .lock()
            .map(|g| g.is_some())
            .unwrap_or(false);
        match monitors::idle_watch(pending, idle_ms, OVERLAY_IDLE_TIMEOUT_MS) {
            IdleWatch::Finished => return,
            IdleWatch::Waiting => {}
            IdleWatch::Expire => {
                eprintln!("knivchit: overlay de captura inactivo, se cancela");
                discard_pending(&app);
                if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
                    let _ = w.destroy();
                }
                finish_capture_ui(&app, CaptureOutcome::IdleTimeout);
                return;
            }
        }
    }
}

/// Elige el monitor bajo el cursor y devuelve la imagen recortada a él junto
/// con su índice. Sin monitores legibles degrada al comportamiento anterior
/// (imagen completa, fullscreen donde caiga).
fn pick_target_monitor(
    app: &AppHandle,
    portal_path: &Path,
) -> Result<(PathBuf, Option<usize>), String> {
    let monitors = app.available_monitors().unwrap_or_default();
    let geoms: Vec<MonitorGeom> = monitors
        .iter()
        .map(|m| MonitorGeom {
            x: m.position().x,
            y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect();
    let cursor = app.cursor_position().ok().map(|p| (p.x, p.y));
    let (img_w, img_h) = image::image_dimensions(portal_path)
        .map_err(|e| format!("no se pudo leer la captura: {e}"))?;
    let index = monitors::pick_monitor(&geoms, cursor);
    let rect = match index {
        Some(i) => monitors::crop_rect_for_monitor(&geoms, i, (img_w, img_h))?,
        None => CropRect { x: 0, y: 0, width: img_w, height: img_h },
    };
    Ok((capture::crop_to_rect(portal_path, rect)?, index))
}

fn discard_pending(app: &AppHandle) {
    cancel_capture_impl(&app.state::<CaptureState>().0);
}

/// Salvavidas: si tras `OVERLAY_TIMEOUT_MS` el overlay no está visible, se
/// destruye, se descarta la captura y se devuelve un error.
async fn wait_for_overlay(app: &AppHandle) -> Result<(), String> {
    const POLL_MS: u64 = 100;
    let mut elapsed = 0u64;
    loop {
        let visible = app
            .get_webview_window(OVERLAY_LABEL)
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        match monitors::overlay_watch(visible, elapsed, OVERLAY_TIMEOUT_MS) {
            OverlayWatch::Visible => return Ok(()),
            OverlayWatch::KeepWaiting => {
                tokio::time::sleep(std::time::Duration::from_millis(POLL_MS)).await;
                elapsed += POLL_MS;
            }
            OverlayWatch::GiveUp => {
                if let Some(w) = app.get_webview_window(OVERLAY_LABEL) {
                    let _ = w.destroy();
                }
                discard_pending(app);
                finish_capture_ui(app, CaptureOutcome::OverlayTimeout);
                return Err("el overlay de captura no apareció en 5 s".to_string());
            }
        }
    }
}

/// Estado del permiso de captura para el hub: `{ granted, last_error }`
/// (`last_error`: `needs_permission`, `cancelled`, `denied`, `portal_unavailable`
/// o `null`). El cambio de estado también llega como evento
/// `capture-permission-changed` con el mismo contenido.
#[tauri::command]
pub fn get_capture_permission(state: State<'_, CapturePermission>) -> CapturePermissionState {
    state.state()
}

/// Modo preparación a petición del usuario («Permitir capturas»): trae la
/// ventana principal al frente y pide al portal una foto de prueba, que se
/// descarta. Resuelve si el permiso queda concedido; rechaza con el código
/// (`cancelled`, `denied`, `portal_unavailable`) o `busy` si ya hay una
/// petición en curso.
#[tauri::command]
pub async fn request_capture_permission(app: AppHandle) -> Result<(), String> {
    let permission = app.state::<CapturePermission>();
    let Some(_guard) = permission.begin_request() else {
        return Err("busy".to_string());
    };
    request_permission(&AppEnv { app: app.clone() })
        .await
        .map_err(|code| code.as_str().to_string())
}

#[tauri::command]
pub async fn start_capture(app: AppHandle) -> Result<(), String> {
    trigger_capture(&app, Trigger::Button).await
}

/// La ventana overlay pide la imagen recién capturada como data URL en vez
/// de vía el protocolo `asset://` — evita tener que abrir el scope de
/// filesystem de las capabilities solo para esto.
#[tauri::command]
pub fn get_capture_preview(state: State<'_, CaptureState>) -> Result<String, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let path = guard
        .as_ref()
        .ok_or_else(|| "no hay una captura pendiente".to_string())?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// `Settings.screenshot_save_dir` guarda rutas con `~` (así queda seteado
/// por default en Onboarding.tsx) — Rust no expande `~` como el shell, hay
/// que resolverlo a mano antes de usarlo como filesystem path real.
fn expand_tilde_with_home(path: &str, home: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        return PathBuf::from(home).join(rest);
    }
    if path == "~" {
        return PathBuf::from(home);
    }
    PathBuf::from(path)
}

pub(crate) fn expand_tilde(path: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    expand_tilde_with_home(path, &home)
}

pub(crate) fn cancel_capture_impl(pending: &Mutex<Option<PathBuf>>) {
    if let Some(path) = pending.lock().unwrap().take() {
        capture::discard_if_temp_crop(&path);
    }
}

#[tauri::command]
pub fn cancel_capture<R: Runtime>(app: AppHandle<R>, state: State<'_, CaptureState>) {
    cancel_capture_impl(&state.0);
    finish_capture_ui(&app, CaptureOutcome::Cancelled);
}

/// Crea la ventana overlay la primera vez; en capturas siguientes la
/// reutiliza (evita el costo de crear un webview nuevo cada vez). `monitor`
/// es el índice (en `available_monitors`, que sigue el orden de GDK) donde
/// debe ir en fullscreen.
///
/// NOTA: en la práctica no se ha visto tomar la rama `existing` — el overlay
/// siempre termina destruido (`wait_for_overlay`/`watch_idle` lo hacen ante
/// timeout, y los caminos de salida normales no lo reutilizan explícitamente
/// hoy). Se deja la reutilización porque es barata y correcta si algún día sí
/// aplica, pero no se la puede dar por ejercitada sin confirmarlo en un
/// GNOME real.
fn show_or_create_overlay(app: &AppHandle, monitor: Option<usize>) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
        fullscreen_on_monitor(app, &existing, monitor)?;
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Arranca oculta — CaptureOverlay.tsx la muestra recién cuando la
    // imagen ya está lista para pintarse (si no, se ve un flash blanco del
    // webview en blanco antes de que cargue nuestro contenido).
    let window = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        WebviewUrl::App("index.html?window=capture-overlay".into()),
    )
    .title(OVERLAY_TITLE)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .background_color(crate::WINDOW_BACKGROUND)
    .on_navigation(crate::navigation::allow_navigation)
    .build()
    .map_err(|e| e.to_string())?;
    fullscreen_on_monitor(app, &window, monitor)
}

/// Tauri no expone el monitor del fullscreen, así que se pide a GTK
/// (`fullscreen_on_monitor`) en el hilo principal. SIN VERIFICAR en Mutter
/// real: sin monitor o ante un fallo cae a `set_fullscreen(true)`.
fn fullscreen_on_monitor(
    app: &AppHandle,
    window: &WebviewWindow,
    monitor: Option<usize>,
) -> Result<(), String> {
    use gtk::prelude::GtkWindowExt;

    let Some(index) = monitor else {
        return window.set_fullscreen(true).map_err(|e| e.to_string());
    };
    let window_for_gtk = window.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        // los tipos de GTK no son Send: se obtienen dentro del hilo principal
        let applied = window_for_gtk.gtk_window().ok().and_then(|gw| {
            let screen = gtk::prelude::WidgetExt::screen(&gw)?;
            gw.fullscreen_on_monitor(&screen, index as i32);
            Some(())
        });
        let _ = tx.send(applied);
    })
    .map_err(|e| e.to_string())?;
    match rx.recv() {
        Ok(Some(())) => Ok(()),
        _ => window.set_fullscreen(true).map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::{CaptureActivity, SkipReason, CAPTURE_DEBOUNCE};

    #[test]
    fn two_near_simultaneous_requests_make_a_single_capture() {
        let a = CaptureActivity::default();
        let t0 = Instant::now();
        assert!(a.try_begin_at(t0, false).is_ok());
        a.end(); // la fase de foto terminó rápido
        let second = a.try_begin_at(t0 + Duration::from_millis(300), false);
        assert_eq!(second.unwrap_err().0, SkipReason::TooSoon);
    }

    #[test]
    fn a_new_capture_1_5_s_after_the_previous_one_closed_is_accepted() {
        let a = CaptureActivity::default();
        let t0 = Instant::now();
        a.try_begin_at(t0, false).unwrap();
        a.end(); // overlay cerrado (Esc)
        assert!(a.try_begin_at(t0 + Duration::from_millis(1500), false).is_ok());
    }

    #[test]
    fn a_request_is_ignored_while_another_is_in_progress_or_the_overlay_is_open() {
        let a = CaptureActivity::default();
        let t0 = Instant::now();
        assert_eq!(a.try_begin_at(t0, false).unwrap().1, 1);
        let late = t0 + CAPTURE_DEBOUNCE * 2;
        assert_eq!(a.try_begin_at(late, false).unwrap_err().0, SkipReason::InProgress);
        a.end();
        assert_eq!(a.try_begin_at(late, true).unwrap_err().0, SkipReason::OverlayOpen);
    }

    #[test]
    fn a_new_capture_is_accepted_after_the_window_and_counts_are_metadata_only() {
        let a = CaptureActivity::default();
        let t0 = Instant::now();
        let (g1, n1) = a.try_begin_at(t0, false).unwrap();
        a.end();
        let _ = a.try_begin_at(t0 + Duration::from_millis(500), false).unwrap_err();
        let (g2, n2) = a.try_begin_at(t0 + CAPTURE_DEBOUNCE, false).unwrap();
        assert_eq!((n1, n2), (1, 2));
        assert!(g2 > g1, "la generación sube: el vigilante de la anterior se retira");
    }

    #[test]
    fn skipped_requests_are_counted() {
        let a = CaptureActivity::default();
        let t0 = Instant::now();
        a.try_begin_at(t0, false).unwrap();
        assert_eq!(a.try_begin_at(t0, false).unwrap_err().1, 1);
        assert_eq!(a.try_begin_at(t0, false).unwrap_err().1, 2);
    }

    use super::*;

    #[test]
    fn cancel_capture_clears_the_pending_path() {
        let pending: Mutex<Option<PathBuf>> = Mutex::new(Some(PathBuf::from("/tmp/x.png")));
        cancel_capture_impl(&pending);
        assert!(pending.lock().unwrap().is_none());
    }

    #[test]
    fn expand_tilde_resolves_home_prefixed_paths() {
        assert_eq!(
            expand_tilde_with_home("~/Pictures/Screenshots", "/home/testuser"),
            PathBuf::from("/home/testuser/Pictures/Screenshots")
        );
        assert_eq!(
            expand_tilde_with_home("~", "/home/testuser"),
            PathBuf::from("/home/testuser")
        );
    }

    #[test]
    fn expand_tilde_leaves_absolute_paths_untouched() {
        assert_eq!(
            expand_tilde_with_home("/already/absolute", "/home/testuser"),
            PathBuf::from("/already/absolute")
        );
    }
}
