//! Ajustes de plataforma que deben aplicarse antes de inicializar GTK.

/// Decide el valor de `GDK_BACKEND` a aplicar, o `None` si no hay que tocarlo.
///
/// El hook de linuxdeploy del AppImage exporta `GDK_BACKEND=x11`, así que bajo
/// Wayland la app correría vía Xwayland (posicionamiento, escala fraccional,
/// foco y fullscreen del overlay distintos del binario nativo). Solo si TODO
/// esto se cumple se cambia a `wayland,x11` (Wayland primero, X11 de
/// respaldo): sesión Wayland, dentro de un AppImage (`APPDIR` definido) y
/// `GDK_BACKEND` exactamente `x11` (lo puso el hook, no el usuario).
pub fn resolve_gdk_backend(get: impl Fn(&str) -> Option<String>) -> Option<String> {
    let non_empty = |name: &str| get(name).filter(|v| !v.is_empty());
    let wayland_session = non_empty("WAYLAND_DISPLAY").is_some()
        && get("XDG_SESSION_TYPE").as_deref() == Some("wayland");
    let in_appimage = non_empty("APPDIR").is_some();
    let forced_x11 = get("GDK_BACKEND").as_deref() == Some("x11");
    (wayland_session && in_appimage && forced_x11).then(|| "wayland,x11".to_string())
}

/// Variables de WebKitGTK que Knivchit PODRÍA fijar por defecto. Ambas
/// APAGADAS: se añadieron al sospechar que el parpadeo, la «pantalla
/// duplicada» y la figura pegada al puntero del overlay eran un problema de
/// renderizado en AMD Radeon 680M + webkit2gtk 2.54, pero la causa real era
/// el arrastre nativo de WebKit (se bloquea con la clase `.capture-surface` y
/// el hook `useNativeDragGuard`); ninguna de
/// las dos lo arregló. Se conserva el mecanismo (y el respeto a la variable
/// del usuario) por si otra GPU o versión de WebKit las necesita; falta
/// confirmarlo con el usuario antes de borrarlo del todo.
const DISABLE_DMABUF_RENDERER_BY_DEFAULT: bool = false;
const DISABLE_COMPOSITING_MODE_BY_DEFAULT: bool = false;

/// Variables de WebKitGTK a fijar por defecto, sin pisar las del usuario:
/// una variable ya definida (incluso vacía) se respeta tal cual. Con las
/// constantes apagadas (hoy) devuelve vacío: comportamiento normal de WebKit.
pub fn resolve_webkit_env(get: impl Fn(&str) -> Option<String>) -> Vec<(&'static str, &'static str)> {
    let mut defaults = Vec::new();
    if DISABLE_DMABUF_RENDERER_BY_DEFAULT {
        defaults.push(("WEBKIT_DISABLE_DMABUF_RENDERER", "1"));
    }
    if DISABLE_COMPOSITING_MODE_BY_DEFAULT {
        defaults.push(("WEBKIT_DISABLE_COMPOSITING_MODE", "1"));
    }
    without_user_defined(defaults, get)
}

/// Quita de `defaults` las variables que el usuario ya definió.
fn without_user_defined(
    mut defaults: Vec<(&'static str, &'static str)>,
    get: impl Fn(&str) -> Option<String>,
) -> Vec<(&'static str, &'static str)> {
    defaults.retain(|(key, _)| get(key).is_none());
    defaults
}

/// Aplica `resolve_webkit_env` sobre el entorno real; mismas condiciones que
/// `apply_gdk_backend` (antes de crear hilos o inicializar GTK).
pub fn apply_webkit_env() {
    for (key, value) in resolve_webkit_env(|k| std::env::var(k).ok()) {
        std::env::set_var(key, value);
    }
}

/// Aplica `resolve_gdk_backend` sobre el entorno real.
pub fn apply_gdk_backend() {
    if let Some(value) = resolve_gdk_backend(|k| std::env::var(k).ok()) {
        // Seguro en edición 2021 (set_var no es `unsafe`) y además solo se
        // llama al inicio de `main`, antes de crear hilos o inicializar GTK,
        // así que nadie lee el entorno de forma concurrente.
        std::env::set_var("GDK_BACKEND", value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve(pairs: &[(&str, &str)]) -> Option<String> {
        let env: HashMap<_, _> = pairs.iter().copied().collect();
        resolve_gdk_backend(|k| env.get(k).map(|v| v.to_string()))
    }

    const WAYLAND: [(&str, &str); 2] = [("WAYLAND_DISPLAY", "wayland-0"), ("XDG_SESSION_TYPE", "wayland")];

    fn with(extra: &[(&'static str, &'static str)]) -> Vec<(&'static str, &'static str)> {
        WAYLAND.iter().copied().chain(extra.iter().copied()).collect()
    }

    #[test]
    fn appimage_on_wayland_with_hook_value_prefers_wayland() {
        let env = with(&[("APPDIR", "/tmp/.mount_x"), ("GDK_BACKEND", "x11")]);
        assert_eq!(resolve(&env), Some("wayland,x11".to_string()));
    }

    #[test]
    fn appimage_on_a_real_x11_session_is_untouched() {
        let env = [("XDG_SESSION_TYPE", "x11"), ("DISPLAY", ":0"), ("APPDIR", "/tmp/.mount_x"), ("GDK_BACKEND", "x11")];
        assert_eq!(resolve(&env), None);
    }

    #[test]
    fn outside_an_appimage_is_untouched() {
        assert_eq!(resolve(&with(&[("GDK_BACKEND", "x11")])), None);
    }

    #[test]
    fn user_chosen_values_are_respected() {
        for value in ["wayland", "x11,wayland", "wayland,x11", ""] {
            let env = with(&[("APPDIR", "/tmp/.mount_x"), ("GDK_BACKEND", value)]);
            assert_eq!(resolve(&env), None, "{value:?}");
        }
    }

    #[test]
    fn missing_gdk_backend_is_untouched() {
        assert_eq!(resolve(&with(&[("APPDIR", "/tmp/.mount_x")])), None);
    }


    #[test]
    fn webkit_env_is_empty_by_default_so_webkit_behaves_normally() {
        assert!(!DISABLE_DMABUF_RENDERER_BY_DEFAULT);
        assert!(!DISABLE_COMPOSITING_MODE_BY_DEFAULT);
        assert!(resolve_webkit_env(|_| None).is_empty());
    }

    #[test]
    fn user_defined_webkit_variables_are_never_overridden() {
        let defaults = vec![
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
        ];
        assert_eq!(without_user_defined(defaults.clone(), |_| None), defaults);
        for value in ["0", "1", ""] {
            let got = without_user_defined(defaults.clone(), |k| {
                (k == "WEBKIT_DISABLE_DMABUF_RENDERER").then(|| value.to_string())
            });
            assert_eq!(got, vec![("WEBKIT_DISABLE_COMPOSITING_MODE", "1")], "{value:?}");
        }
    }
}
