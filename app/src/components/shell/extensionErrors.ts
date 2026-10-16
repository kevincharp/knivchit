import { APP_NAME } from "../../lib/appName";

/** La extensión cargada es una versión vieja que no conoce los métodos nuevos. */
export const OUTDATED_MESSAGE =
	"Reinicia la sesión para cargar la extensión actualizada.";

/** La extensión está, pero no acepta cambios desde esta ventana. */
export const SHORTCUTS_UNAVAILABLE_MESSAGE = `La extensión no acepta cambios desde esta ventana. Reinicia ${APP_NAME} y cierra la sesión.`;

/** La extensión de GNOME Shell no está cargada. */
export const INACTIVE_MESSAGE =
	"La extensión de GNOME Shell no está activa. Cierra sesión y vuelve a entrar para activarla.";

/** Códigos con los que el backend rechaza una orden a la extensión. */
export type ExtensionErrorCode =
	| "extension_inactive"
	| "extension_outdated"
	| "shortcuts_unavailable";

/** Código de error de la extensión, o `null` si el rechazo es otro. */
export function extensionErrorCode(e: unknown): ExtensionErrorCode | null {
	const text = e instanceof Error ? e.message : String(e);
	return text === "extension_inactive" ||
		text === "extension_outdated" ||
		text === "shortcuts_unavailable"
		? text
		: null;
}

/** Texto legible para un rechazo del backend; los códigos conocidos se traducen, el resto pasa tal cual. */
export function extensionErrorMessage(e: unknown): string {
	switch (extensionErrorCode(e)) {
		case "extension_inactive":
			return INACTIVE_MESSAGE;
		case "extension_outdated":
			return OUTDATED_MESSAGE;
		// Distinto de extension_inactive: activar la extensión no lo arregla.
		case "shortcuts_unavailable":
			return SHORTCUTS_UNAVAILABLE_MESSAGE;
		default:
			return e instanceof Error ? e.message : String(e);
	}
}
