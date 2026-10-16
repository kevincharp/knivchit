// Reconocimiento de las ventanas de Knivchit por título. Función pura, sin
// gi://Shell ni gi://Meta: el título lo fija la app (backend) al crearlas y
// es lo único estable bajo Wayland, porque wm_class sale del nombre del
// binario y gtk_application_id llega vacío.
const PIN_TITLE_PREFIX = "knivchit-pin";

export function isPinWindowTitle(title) {
  return typeof title === "string" && title.startsWith(PIN_TITLE_PREFIX);
}

// La ventana principal usa exactamente este título (tauri.conf.json,
// app.windows[main].title). Comparación exacta a propósito: el overlay
// («knivchit-capture-overlay») y los pins («knivchit-pin-…») no deben moverse.
const MAIN_TITLE = "Knivchit";

export function isMainWindowTitle(title) {
  return title === MAIN_TITLE;
}

// El overlay de captura (ventana a pantalla completa con la foto congelada) lleva
// este título exacto. El Shell le aplicaría su animación de mapeo (zoom desde
// abajo + fundido, ~170 ms) y de cierre (encoge y se desvanece, ~150 ms), que
// delante de la foto se ven como un «efecto de movimiento»: la extensión las omite.
const CAPTURE_OVERLAY_TITLE = "knivchit-capture-overlay";

export function isCaptureOverlayTitle(title) {
  return title === CAPTURE_OVERLAY_TITLE;
}

// ¿La ventana es de la propia aplicación? El título lo puede poner cualquier programa, así que
// además del título se exige que el proceso de la ventana sea el dueño de org.knivchit.App.
// `appPid` es null mientras la app no está en el bus.
export function isOwnedByApp(windowPid, appPid) {
  return Number.isInteger(windowPid) && windowPid > 0 && windowPid === appPid;
}
