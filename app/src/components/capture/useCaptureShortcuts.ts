import { useEffect, useRef } from "react";
import type { Tool } from "./annotationPalette";
import { toolForKey } from "./toolShortcuts";

interface Handlers {
	onCancel: () => void;
	onConfirm: () => void;
	onCopy: () => void;
	onSave: () => void;
	onSaveAs: () => void;
	onUndo: () => void;
	onRedo: () => void;
	/** Atajo de herramienta (Alt+letra o letra sola); el llamador alterna si ya está activa. */
	onToolKey: (tool: Tool) => void;
	onHelp: () => void;
	onDeleteSelected: () => void;
	/** Enter con un texto elegido: entra a editar su contenido. Devuelve `true` si lo hizo (entonces Enter no copia). */
	onEditSelected?: () => boolean;
}

/**
 * Atajos del overlay: Esc cancela, Enter y Ctrl+C copian y cierran, Ctrl+S
 * guarda, Ctrl+Shift+S abre «Guardar como…», Ctrl+Z deshace, Ctrl+Shift+Z
 * (o Ctrl+Y) rehace, Alt+letra o la letra sola eligen herramienta (ver
 * toolShortcuts.ts), `?` abre la ayuda y Supr/Retroceso borran la anotación
 * seleccionada. Con un texto elegido, Enter lo edita en vez de copiar. Escribiendo un texto solo actúa Alt+letra (confirma el texto y
 * cambia de herramienta); Enter respeta un botón enfocado con teclado.
 */
export function useCaptureShortcuts(handlers: Handlers) {
	// Los listeners se registran UNA vez y leen siempre los manejadores del
	// último render. Si se re-registraran en cada render, el evento que cambia
	// el estado (Alt+H) llegaría a `window` con un listener nuevo que no lo ha
	// visto y lo procesaría otra vez: la herramienta se encendería y apagaría.
	const ref = useRef(handlers);
	ref.current = handlers;
	useEffect(() => {
		// Un mismo evento llega por document (captura) y por window: se procesa una vez.
		const seen = new WeakSet<Event>();
		function onKeyDown(e: KeyboardEvent) {
			if (seen.has(e)) return;
			seen.add(e);
			const h = ref.current;
			// La autorepetición (tecla mantenida) solo tiene sentido al deshacer/rehacer,
			// como en cualquier editor. En el resto sería dañina: Alt+H alterna y
			// quedaría apagada con un número par de repeticiones; Supr borraría de más;
			// Enter o Ctrl+S repetirían la salida.
			if (e.repeat && !((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key))) {
				if (toolForKey(e, true)) e.preventDefault();
				return;
			}
			const target = e.target instanceof Element ? e.target : null;
			if (target?.closest("textarea, input")) {
				const t = toolForKey(e, true);
				if (t) {
					e.preventDefault();
					// El blur confirma el texto en curso antes de cambiar de herramienta.
					(target as HTMLElement).blur();
					h.onToolKey(t);
				}
				return;
			}
			const mod = e.ctrlKey || e.metaKey;
			const tool = toolForKey(e, false);
			const key = e.key.toLowerCase();
			if (e.key === "Escape") {
				e.preventDefault();
				h.onCancel();
			} else if (e.key === "Enter" && !mod) {
				if (target?.closest("button") && target.matches(":focus-visible")) {
					return;
				}
				e.preventDefault();
				if (h.onEditSelected?.()) return;
				h.onConfirm();
			} else if (mod && key === "c") {
				e.preventDefault();
				h.onCopy();
			} else if (mod && key === "s") {
				e.preventDefault();
				if (e.shiftKey) h.onSaveAs();
				else h.onSave();
			} else if (mod && key === "z") {
				e.preventDefault();
				if (e.shiftKey) h.onRedo();
				else h.onUndo();
			} else if (mod && key === "y") {
				e.preventDefault();
				h.onRedo();
			} else if (tool) {
				e.preventDefault();
				h.onToolKey(tool);
			} else if (e.key === "?" && !mod && !e.altKey) {
				e.preventDefault();
				h.onHelp();
			} else if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				h.onDeleteSelected();
			}
		}
		// Captura en document: si el foco queda en un elemento que frena la
		// propagación, Esc igual llega. window cubre el caso sin document como destino.
		document.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, []);
}
