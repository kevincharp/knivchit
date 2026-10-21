//! Ventana del panel con runtime simulado: alterna, cambia de pestaña y
//! nunca hay dos ventanas `picker`. El runtime simulado no emite `Destroyed`,
//! así que el cierre se observa en `PickerState` y no en el mapa de ventanas.

use knivchit_lib::commands::picker::{
    open_picker, pick_emoji, show_picker, EmojiSet, PickerState, PICKER_LABEL,
};
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::{Manager, WebviewWindowBuilder};

type App = tauri::App<tauri::test::MockRuntime>;

fn app() -> App {
    mock_builder()
        .manage(PickerState::default())
        .manage(EmojiSet::from_json(r#"[{"char":"🧉"}]"#).unwrap())
        .build(mock_context(noop_assets()))
        .unwrap()
}

fn pickers(app: &App) -> usize {
    app.webview_windows().keys().filter(|l| l.as_str() == PICKER_LABEL).count()
}

fn open_tab(app: &App) -> Option<String> {
    app.state::<PickerState>().current_tab()
}

#[test]
fn the_same_tab_twice_toggles_the_window_closed() {
    let app = app();
    show_picker(&app, "emoji").unwrap();
    assert_eq!(pickers(&app), 1);
    assert_eq!(open_tab(&app).as_deref(), Some("emoji"));
    show_picker(&app, "emoji").unwrap();
    assert_eq!(open_tab(&app), None);
}

#[test]
fn the_other_tab_switches_without_a_second_window() {
    let app = app();
    show_picker(&app, "emoji").unwrap();
    show_picker(&app, "clipboard").unwrap();
    assert_eq!(pickers(&app), 1);
    assert_eq!(open_tab(&app).as_deref(), Some("clipboard"));
}

#[test]
fn open_picker_rejects_an_unknown_tab_and_creates_nothing() {
    let app = app();
    assert!(open_picker(app.handle().clone(), "otra".into()).is_err());
    assert_eq!(pickers(&app), 0);
    assert!(open_picker(app.handle().clone(), "emoji".into()).is_ok());
    assert_eq!(pickers(&app), 1);
}

#[test]
fn pick_emoji_from_another_window_is_refused_before_touching_the_clipboard() {
    let app = app();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let error = tauri::async_runtime::block_on(pick_emoji(main, app.handle().clone(), "🧉".into()))
        .unwrap_err();
    assert!(error.contains("solo la ventana del panel"), "{error}");
}
