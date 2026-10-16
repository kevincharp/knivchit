// Decisión pura de qué hacer tras una llamada D-Bus a org.knivchit.App: sin
// gi://Shell, gi://Meta ni Main, para poder probarla con `gjs` a secas. La
// llamada en sí (Gio.DBus.session.call, el temporizador del reintento,
// Main.notify) vive en extension.js — ver su comentario de testeabilidad.
export const RETRY_DELAY_MS = 1500;
export const UNAVAILABLE_MESSAGE = "No se pudo iniciar Knivchit. Revisa la instalación.";

/**
 * `attempt` es el intento que acaba de terminar (1 o 2); `failed`, si esa
 * llamada falló. Un solo reintento: si el primer intento falla, esperar
 * `RETRY_DELAY_MS` y reintentar; si el segundo también falla, avisar.
 */
export function decideCallAppOutcome(attempt, failed) {
	if (!failed) return { action: "done" };
	if (attempt === 1) return { action: "retry", delayMs: RETRY_DELAY_MS };
	return { action: "notify", message: UNAVAILABLE_MESSAGE };
}
