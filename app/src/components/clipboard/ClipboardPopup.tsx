import { ClipboardCardList } from "./ClipboardCardList";

/**
 * Contenido de la ventana flotante del historial de portapapeles.
 * La ventana en sí (WebviewWindow separada, always-on-top, sin decoración,
 * posicionada cerca del cursor al recibir TogglePopup) se configura en
 * tauri.conf.json / el código nativo que la muestra/oculta — este
 * componente es solo lo que se renderiza adentro.
 */
export function ClipboardPopup() {
	return (
		<div className="min-h-full w-80 rounded-[var(--radius-ui)] bg-[rgba(27,32,48,.72)] p-3 backdrop-blur-xl">
			<ClipboardCardList />
		</div>
	);
}
