import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Único punto de entrada a invoke(): ningún componente llama a Tauri directo,
// siempre a través de estos wrappers.

/** Pide una captura completa de pantalla y abre la ventana overlay de selección. */
export async function startCapture(): Promise<void> {
	return invoke("start_capture");
}

/** Data URL (`data:image/png;base64,...`) de la captura pendiente — la pide la ventana overlay al montarse. */
export async function getCapturePreview(): Promise<string> {
	return invoke<string>("get_capture_preview");
}

/** Guarda el PNG ya compuesto en la carpeta de los ajustes (la lee el backend; se crea si falta). Devuelve la ruta final. Consume la captura pendiente. */
export async function saveCapture(png: Uint8Array): Promise<string> {
	return invoke<string>("save_capture", png);
}

/**
 * Abre el diálogo nativo «Guardar como» con la carpeta configurada ya
 * cargada. Devuelve la ruta elegida, o `null` si el usuario cancela — en ese
 * caso la captura sigue pendiente, no se consume.
 */
export async function saveCaptureAs(png: Uint8Array): Promise<string | null> {
	return invoke<string | null>("save_capture_as", png);
}

/** Pone el PNG ya compuesto en el portapapeles de la sesión. Consume la captura pendiente. */
export async function copyCapture(png: Uint8Array): Promise<void> {
	return invoke("copy_capture", png);
}

/** Abre una ventana flotante con el PNG. `width`/`height` en px lógicos. Devuelve su label `pin-<uuid>`. */
export async function pinCapture(
	png: Uint8Array,
	width: number,
	height: number,
): Promise<string> {
	return invoke<string>("pin_capture", png, {
		headers: {
			"x-width": String(Math.round(width)),
			"x-height": String(Math.round(height)),
		},
	});
}

/** Data URL de la imagen de una ventana `pin-*`; solo la ventana dueña del label puede pedirla. */
export async function getPinImage(label: string): Promise<string> {
	return invoke<string>("get_pin_image", { label });
}

/** Cierra la ventana `pin-*` y libera su PNG. */
export async function closePin(label: string): Promise<void> {
	return invoke("close_pin", { label });
}

/** Avisa al vigilante del backend que el usuario sigue usando el overlay (si no, se cancela a los 60 s). */
export async function captureActivity(): Promise<void> {
	return invoke("capture_activity");
}

/** Descarta la captura pendiente sin guardar nada. */
export async function cancelCapture(): Promise<void> {
	return invoke("cancel_capture");
}

export interface ClipboardEntry {
	id: string;
	content_type: "text" | "image" | "link";
	content: string;
	preview: string | null;
	source_app: string | null;
	created_at: string;
	pinned: boolean;
}

export async function getClipboardHistory(): Promise<ClipboardEntry[]> {
	return invoke<ClipboardEntry[]>("get_clipboard_history");
}

export async function pinClipboardEntry(id: string): Promise<void> {
	return invoke("pin_clipboard_entry", { id });
}

export async function deleteClipboardEntry(id: string): Promise<void> {
	return invoke("delete_clipboard_entry", { id });
}

export async function clearClipboardHistory(): Promise<void> {
	return invoke("clear_clipboard_history");
}

export interface Settings {
	screenshot_save_dir: string;
	clipboard_cap_count: number;
	clipboard_cap_days: number;
	sensitive_exclude_enabled: boolean;
}

export async function getSettings(): Promise<Settings> {
	return invoke<Settings>("get_settings");
}

export async function updateSettings(settings: Settings): Promise<void> {
	return invoke("update_settings", { settings });
}

/** Cierra (destruye) la ventana actual; el proceso sigue vivo. */
export async function closeCurrentWindow(): Promise<void> {
	return getCurrentWindow().close();
}

/** Minimiza la ventana actual. */
export async function minimizeCurrentWindow(): Promise<void> {
	return getCurrentWindow().minimize();
}

export interface IntegrationStatus {
	/** La extensión de GNOME Shell está cargada (el atajo global funciona). */
	extension_active: boolean;
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
	return invoke<IntegrationStatus>("get_integration_status");
}

/** Selector de carpeta del portal XDG. Ruta absoluta, o `null` si el usuario cancela. */
export async function chooseSaveDir(): Promise<string | null> {
	return invoke<string | null>("choose_save_dir");
}

export async function getAutostart(): Promise<boolean> {
	return invoke<boolean>("get_autostart");
}

export async function setAutostart(enabled: boolean): Promise<void> {
	return invoke("set_autostart", { enabled });
}

export interface UpdateInfo {
	has_update: boolean;
	latest_version: string;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
	return invoke<UpdateInfo>("check_for_update");
}

export async function getAppVersion(): Promise<string> {
	return getVersion();
}

/** Abre en el gestor de archivos la carpeta de guardado ya configurada (el backend la valida). */
export async function openSaveDir(): Promise<void> {
	return invoke("open_save_dir");
}

export interface ShortcutsState {
	/** La extensión de GNOME Shell está cargada: sin ella no se pueden leer ni cambiar atajos. */
	extension_active: boolean;
	/** Acción → acelerador GTK (`<Super><Shift>c`). Una acción sin asignar no figura o va vacía. */
	shortcuts: Record<string, string>;
}

export async function getShortcuts(): Promise<ShortcutsState> {
	return invoke<ShortcutsState>("get_shortcuts");
}

/** Asigna un acelerador GTK a la acción; `null` (o vacío) lo quita. Rechaza con «extension_inactive» si no hay extensión, o con «shortcuts_unavailable» si la extensión no acepta cambios (activarla no lo arregla). */
export async function setShortcut(
	action: string,
	accel: string | null,
): Promise<void> {
	return invoke("set_shortcut", { action, accel: accel ?? "" });
}

/** Textos de los atajos de GNOME o del usuario que ya usan ese acelerador (vacío = libre). También puede rechazar con «shortcuts_unavailable». */
export async function checkShortcutConflicts(accel: string): Promise<string[]> {
	return invoke<string[]>("check_shortcut_conflicts", { accel });
}

export type RecordStatus =
	| "ok"
	| "cancelled"
	| "timeout"
	| "busy"
	| "invalid"
	/** Otra extensión tiene un modal abierto y el Shell no deja capturar el teclado. */
	| "unavailable";

export interface RecordResult {
	/** Acelerador GTK grabado (vacío salvo en `ok`). */
	accel: string;
	status: RecordStatus;
	/** Motivo legible de la extensión (con `invalid` y `unavailable`): se muestra tal cual; vacío en los demás estados. */
	message?: string;
}

/** La extensión graba la combinación con un grab modal del Shell: Esc o un clic la cancelan. */
export async function recordShortcut(): Promise<RecordResult> {
	return invoke<RecordResult>("record_shortcut");
}

export interface PanelIconInfo {
	/** La extensión de GNOME Shell está cargada y deja cambiar el icono; sin ella `enabled` no significa nada. */
	extension_active: boolean;
	/** El icono de la barra superior está visible (por defecto, sí). */
	enabled: boolean;
}

export async function getPanelIcon(): Promise<PanelIconInfo> {
	return invoke<PanelIconInfo>("get_panel_icon");
}

/**
 * Muestra u oculta el icono de la barra superior. Rechaza con «extension_inactive»,
 * «shortcuts_unavailable» (activar la extensión no lo arregla) o «extension_outdated».
 */
export async function setPanelIcon(enabled: boolean): Promise<void> {
	return invoke("set_panel_icon", { enabled });
}

/** Cierra Knivchit por completo (cerrar la ventana no termina el proceso). */
export async function quitApp(): Promise<void> {
	return invoke("quit_app");
}

/** Por qué no hay (o dejó de haber) permiso de captura. Cadenas estables del backend. */
export type CaptureErrorCode =
	| "needs_permission"
	| "cancelled"
	| "denied"
	| "portal_unavailable";

export interface CapturePermissionState {
	/** GNOME ya concedió el permiso de captura. */
	granted: boolean;
	/** Último fallo del portal, o `null` si no lo hay. */
	last_error: CaptureErrorCode | null;
}

const CAPTURE_ERROR_CODES: readonly string[] = [
	"needs_permission",
	"cancelled",
	"denied",
	"portal_unavailable",
];

/** Código de permiso con el que el backend rechaza una orden, o `null` si el rechazo es otro. */
export function captureErrorCode(e: unknown): CaptureErrorCode | null {
	const text = e instanceof Error ? e.message : String(e);
	return CAPTURE_ERROR_CODES.includes(text) ? (text as CaptureErrorCode) : null;
}

export async function getCapturePermission(): Promise<CapturePermissionState> {
	return invoke<CapturePermissionState>("get_capture_permission");
}

/**
 * Trae la ventana principal al frente y pide la captura para que GNOME muestre su
 * aviso de permiso. Resuelve si queda concedido; rechaza con un código de
 * `CaptureErrorCode`.
 */
export async function requestCapturePermission(): Promise<void> {
	return invoke("request_capture_permission");
}

/** Suscripción a los cambios del permiso (p. ej. el atajo pulsado sin permiso). Devuelve la función que la cancela. */
export async function onCapturePermissionChanged(
	callback: (state: CapturePermissionState) => void,
): Promise<() => void> {
	return listen<CapturePermissionState>("capture-permission-changed", (e) =>
		callback(e.payload),
	);
}
