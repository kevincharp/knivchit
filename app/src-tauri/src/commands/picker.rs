//! Panel flotante `picker`: una sola ventana de 320×400 que la app crea y
//! la extensión coloca (reconocida por el título). Alterna con el atajo, cambia
//! de pestaña si se pide la otra y se cierra sola tras un rato sin actividad.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

pub const PICKER_LABEL: &str = "picker";
pub const PICKER_TITLE: &str = "knivchit-picker";
const PICKER_SIZE: (f64, f64) = (320.0, 400.0);
const TABS: [&str; 2] = ["emoji", "clipboard"];

/// Sin teclas ni clics en el panel durante este tiempo, se cierra.
pub const PICKER_IDLE_LIMIT_MS: u64 = 120_000;
const IDLE_POLL: Duration = Duration::from_secs(10);

/// Pestaña abierta (si hay ventana) y último instante de actividad.
pub struct PickerState {
    tab: Mutex<Option<String>>,
    last_activity: Mutex<Instant>,
}

impl Default for PickerState {
    fn default() -> Self {
        Self {
            tab: Mutex::new(None),
            last_activity: Mutex::new(Instant::now()),
        }
    }
}

impl PickerState {
    pub fn current_tab(&self) -> Option<String> {
        self.tab.lock().unwrap().clone()
    }

    fn set_tab(&self, tab: Option<&str>) {
        *self.tab.lock().unwrap() = tab.map(str::to_string);
    }

    fn touch(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    fn idle_ms(&self) -> u64 {
        self.last_activity.lock().unwrap().elapsed().as_millis() as u64
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PickerAction {
    Create,
    SwitchTab,
    Close,
}

/// `current` es la pestaña de la ventana existente (`None` si no hay).
pub fn decide_toggle(visible: bool, current: Option<&str>, requested: &str) -> PickerAction {
    match current {
        None => PickerAction::Create,
        Some(tab) if visible && tab == requested => PickerAction::Close,
        Some(_) => PickerAction::SwitchTab,
    }
}

pub fn picker_idle_expired(idle_ms: u64, limit_ms: u64) -> bool {
    idle_ms >= limit_ms
}

fn close_window<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.state::<PickerState>().set_tab(None);
    window.close()
}

fn announce_tab<R: Runtime>(window: &WebviewWindow<R>, tab: &str) {
    let _ = window.emit_to(PICKER_LABEL, "picker://show", serde_json::json!({ "tab": tab }));
}

fn create_picker<R: Runtime, M: Manager<R>>(app: &M) -> tauri::Result<()> {
    // Nace oculta: se muestra al terminar de cargar para no enseñar el webview en blanco.
    WebviewWindowBuilder::new(
        app,
        PICKER_LABEL,
        WebviewUrl::App("index.html?window=picker".into()),
    )
    .title(PICKER_TITLE)
    .inner_size(PICKER_SIZE.0, PICKER_SIZE.1)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .on_navigation(crate::navigation::allow_navigation)
    .on_page_load(move |window, payload| {
        if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
            let _ = window.show();
            // La pestaña vigente, no la del pedido: pudo cambiar mientras cargaba.
            if let Some(tab) = window.state::<PickerState>().current_tab() {
                announce_tab(&window, &tab);
            }
        }
    })
    .build()?
    .on_window_event({
        let app = app.app_handle().clone();
        move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                app.state::<PickerState>().set_tab(None);
            }
        }
    });
    Ok(())
}

/// Abre, cambia de pestaña o cierra el panel según `decide_toggle`. `tab` ya
/// debe estar validado.
pub fn show_picker<R: Runtime, M: Manager<R>>(app: &M, tab: &str) -> tauri::Result<()> {
    let state = app.state::<PickerState>();
    let existing = app.get_webview_window(PICKER_LABEL);
    let visible = existing.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false));
    let current = existing.as_ref().and(state.current_tab());
    state.touch();
    match (decide_toggle(visible, current.as_deref(), tab), existing) {
        (PickerAction::Close, Some(window)) => {
            close_window(&window)
        }
        (PickerAction::SwitchTab, Some(window)) => {
            state.set_tab(Some(tab));
            window.show()?;
            announce_tab(&window, tab);
            Ok(())
        }
        _ => {
            state.set_tab(Some(tab));
            create_picker(app)
        }
    }
}

/// Cierra el panel si lleva demasiado inactivo; la revisa cada `IDLE_POLL`.
pub fn spawn_idle_watch<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(IDLE_POLL).await;
            let state = app.state::<PickerState>();
            if picker_idle_expired(state.idle_ms(), PICKER_IDLE_LIMIT_MS) {
                if let Some(window) = app.get_webview_window(PICKER_LABEL) {
                    let _ = close_window(&window);
                }
            }
        }
    });
}

fn check_picker<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() != PICKER_LABEL {
        return Err("solo la ventana del panel puede usar este comando".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn close_picker<R: Runtime>(window: WebviewWindow<R>) -> Result<(), String> {
    check_picker(&window)?;
    close_window(&window).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn picker_activity<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, PickerState>,
) -> Result<(), String> {
    check_picker(&window)?;
    state.touch();
    Ok(())
}

/// Emojis que el backend acepta copiar (R27): lo que llega del webview solo
/// vale si coincide exactamente con uno del conjunto embebido.
pub struct EmojiSet(HashSet<String>);

impl EmojiSet {
    pub fn from_json(json: &str) -> Result<Self, String> {
        #[derive(serde::Deserialize)]
        struct Entry {
            char: String,
        }
        let entries: Vec<Entry> =
            serde_json::from_str(json).map_err(|e| format!("datos de emojis no válidos: {e}"))?;
        Ok(Self(entries.into_iter().map(|e| e.char).collect()))
    }

    pub fn contains(&self, text: &str) -> bool {
        self.0.contains(text)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PickOutcome {
    Copied,
    Inserted,
}

fn pick_emoji_with(
    caller_label: &str,
    set: &EmojiSet,
    emoji: &str,
    copy: impl FnOnce(&str) -> Result<(), String>,
) -> Result<PickOutcome, String> {
    if caller_label != PICKER_LABEL {
        return Err("solo la ventana del panel puede elegir un emoji".to_string());
    }
    if !set.contains(emoji) {
        return Err("emoji no válido".to_string());
    }
    copy(emoji)?;
    Ok(PickOutcome::Copied)
}

fn set_clipboard_text(text: &str) -> Result<(), String> {
    if !gtk::is_initialized_main_thread() {
        return Err("GTK no está inicializado (¿sin display?)".to_string());
    }
    let display = gtk::gdk::Display::default().ok_or_else(|| "no hay display".to_string())?;
    let clipboard = gtk::Clipboard::default(&display)
        .ok_or_else(|| "no hay portapapeles disponible".to_string())?;
    clipboard.set_text(text);
    Ok(())
}

#[tauri::command]
pub async fn pick_emoji<R: Runtime>(
    window: WebviewWindow<R>,
    app: AppHandle<R>,
    emoji: String,
) -> Result<PickOutcome, String> {
    let set = app
        .try_state::<EmojiSet>()
        .ok_or_else(|| "los datos de emojis no están cargados".to_string())?;
    pick_emoji_with(window.label(), &set, &emoji, |text| {
        let text = text.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(set_clipboard_text(&text));
        })
        .map_err(|e| format!("no se pudo acceder al hilo principal: {e}"))?;
        rx.recv().map_err(|_| "el hilo principal no respondió".to_string())?
    })
}

#[tauri::command]
pub fn open_picker<R: Runtime>(app: AppHandle<R>, tab: String) -> Result<(), String> {
    if !TABS.contains(&tab.as_str()) {
        return Err(format!("pestaña no válida: {tab}"));
    }
    show_picker(&app, &tab).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_creates_switches_or_closes() {
        assert_eq!(decide_toggle(false, None, "emoji"), PickerAction::Create);
        assert_eq!(decide_toggle(true, None, "emoji"), PickerAction::Create);
        assert_eq!(decide_toggle(true, Some("emoji"), "clipboard"), PickerAction::SwitchTab);
        assert_eq!(decide_toggle(true, Some("emoji"), "emoji"), PickerAction::Close);
        assert_eq!(decide_toggle(false, Some("emoji"), "emoji"), PickerAction::SwitchTab);
    }

    const EMOJIS: &str = r#"[{"char":"😀"},{"char":"👨‍👩‍👧‍👦"},{"char":"🇦🇷"},{"char":"❤️"},{"char":"🧉"}]"#;

    #[test]
    fn the_set_accepts_exact_emojis_only() {
        let set = EmojiSet::from_json(EMOJIS).unwrap();
        for ok in ["😀", "👨‍👩‍👧‍👦", "🇦🇷", "❤️", "🧉"] {
            assert!(set.contains(ok), "{ok}");
        }
        for bad in ["😀😀", "a", "", "😀\n", "❤", "🍕"] {
            assert!(!set.contains(bad), "{bad:?}");
        }
        assert!(EmojiSet::from_json("no es json").is_err());
    }

    #[test]
    fn picking_copies_a_valid_emoji_from_the_picker_only() {
        let set = EmojiSet::from_json(EMOJIS).unwrap();
        let mut copied = Vec::new();
        let outcome = pick_emoji_with(PICKER_LABEL, &set, "🧉", |t| {
            copied.push(t.to_string());
            Ok(())
        });
        assert_eq!(outcome, Ok(PickOutcome::Copied));
        assert_eq!(copied, ["🧉"]);

        for (label, emoji) in [("main", "🧉"), (PICKER_LABEL, "🍕")] {
            let outcome = pick_emoji_with(label, &set, emoji, |_| panic!("no debe copiar"));
            assert!(outcome.is_err(), "{label} {emoji}");
        }
    }

    #[test]
    fn the_outcome_serializes_in_lowercase() {
        assert_eq!(serde_json::to_string(&PickOutcome::Copied).unwrap(), "\"copied\"");
        assert_eq!(serde_json::to_string(&PickOutcome::Inserted).unwrap(), "\"inserted\"");
    }

    #[test]
    fn idle_expires_exactly_at_the_limit() {
        assert!(picker_idle_expired(120_000, PICKER_IDLE_LIMIT_MS));
        assert!(!picker_idle_expired(119_999, PICKER_IDLE_LIMIT_MS));
    }
}
