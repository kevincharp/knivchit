import { useEffect } from "react";

interface Options {
	/**
	 * Cancela también `mousedown` (WebKit solo evita el arrastre nativo si se
	 * cancela el mousedown, no basta con el pointerdown). Apagarlo donde
	 * `data-tauri-drag-region` necesite ese mousedown (pin, barra de título).
	 */
	blockMouseDown?: boolean;
}

function elementOf(target: EventTarget | null): Element | null {
	if (target instanceof Element) return target;
	return target instanceof Node ? target.parentElement : null;
}

/** Los campos de texto conservan selección, foco y caret. */
function isEditable(target: EventTarget | null): boolean {
	return elementOf(target)?.closest("textarea, input") != null;
}

/**
 * WebKitGTK inicia un arrastre nativo (HTML5 drag and drop) al pulsar y mover
 * sobre contenido seleccionable o una imagen: dibuja un fantasma
 * semitransparente de la página y deja de entregar pointermove/pointerup al
 * gesto. Mientras el componente está montado, cancela en captura sobre
 * `document` todo lo que lo inicia y limpia cualquier selección previa.
 */
export function useNativeDragGuard({ blockMouseDown = false }: Options = {}) {
	useEffect(() => {
		const cancel = (e: Event) => {
			if (isEditable(e.target)) return;
			e.preventDefault();
		};
		const cancelMouseDown = (e: MouseEvent) => {
			// La toolbar conserva foco y clic normales; el resto es superficie de gesto.
			if (isEditable(e.target)) return;
			if (elementOf(e.target)?.closest("[data-capture-toolbar]")) return;
			e.preventDefault();
			window.getSelection()?.removeAllRanges();
		};
		const events = [
			"dragstart",
			"drag",
			"dragover",
			"selectstart",
			"gesturestart",
			"gesturechange",
		] as const;
		for (const name of events) document.addEventListener(name, cancel, true);
		if (blockMouseDown) {
			document.addEventListener("mousedown", cancelMouseDown, true);
		}
		window.getSelection()?.removeAllRanges();
		return () => {
			for (const name of events) {
				document.removeEventListener(name, cancel, true);
			}
			document.removeEventListener("mousedown", cancelMouseDown, true);
		};
	}, [blockMouseDown]);
}
