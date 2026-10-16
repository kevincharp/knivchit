//! Navegación permitida en los webviews propios (pin, overlay). Ningún
//! enlace, redirección ni `location = …` puede sacarlos del bundle de la app:
//! un webview con comandos expuestos que cargue una página remota es
//! ejecución remota de código con permisos de filesystem.

use tauri::Url;

/// Origen del bundle: `tauri://localhost` en Linux/macOS y
/// `http(s)://tauri.localhost` en Windows. En compilaciones de depuración
/// también el servidor de Vite (`devUrl` de `tauri.conf.json`).
pub fn is_app_url(url: &Url, debug: bool) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("http", Some("localhost")) => debug && url.port() == Some(1420),
        _ => false,
    }
}

/// Para `WebviewWindowBuilder::on_navigation`.
pub fn allow_navigation(url: &Url) -> bool {
    is_app_url(url, cfg!(debug_assertions))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        s.parse().unwrap()
    }

    #[test]
    fn allows_the_app_bundle_origin() {
        assert!(is_app_url(&u("tauri://localhost/index.html?window=pin"), false));
        assert!(is_app_url(&u("http://tauri.localhost/"), false));
        assert!(is_app_url(&u("https://tauri.localhost/x"), false));
    }

    #[test]
    fn dev_server_only_in_debug_builds() {
        assert!(is_app_url(&u("http://localhost:1420/"), true));
        assert!(!is_app_url(&u("http://localhost:1420/"), false));
        assert!(!is_app_url(&u("http://localhost:8080/"), true));
    }

    #[test]
    fn rejects_everything_else() {
        for bad in [
            "https://example.com/",
            "http://tauri.localhost.evil.com/",
            "tauri://evil/",
            "file:///etc/passwd",
            "data:text/html,<script>1</script>",
            "javascript:alert(1)",
            "about:blank",
            "http://127.0.0.1:1420/",
        ] {
            assert!(!is_app_url(&u(bad), true), "{bad}");
        }
    }
}
