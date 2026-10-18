// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Antes de cualquier hilo o de inicializar GTK (ver platform.rs).
    knivchit_lib::platform::apply_gdk_backend();
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--version" {
        println!("knivchit {}", env!("CARGO_PKG_VERSION"));
        std::process::exit(0);
    }
    knivchit_lib::logging::install_panic_hook(
        knivchit_lib::logging::default_log_path(),
        knivchit_lib::logging::DEFAULT_MAX_LOG_BYTES,
    );
    knivchit_lib::run()
}
