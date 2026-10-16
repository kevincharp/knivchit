import { useCallback, useEffect, useRef } from "react";
import { captureActivity } from "../../lib/tauri";

export type ActivityKind =
	| "mousedown"
	| "mousemove"
	| "keydown"
	| "selection"
	| "tool";

/** Intervalo mínimo (ms) entre avisos de cada tipo, para no inundar el IPC. */
export const ACTIVITY_INTERVALS: Record<ActivityKind, number> = {
	mousedown: 0,
	mousemove: 5000,
	keydown: 1000,
	selection: 1000,
	tool: 0,
};

/**
 * Avisa al backend de la actividad real del usuario en el overlay. Escucha
 * mousedown, mousemove y keydown en document (captura); los cambios de
 * selección y herramienta los notifica el overlay con `notify`. Un fallo del
 * IPC se ignora: nunca debe romper ni cancelar el flujo.
 */
export function useCaptureActivity(): (kind: ActivityKind) => void {
	const last = useRef<Partial<Record<ActivityKind, number>>>({});

	const notify = useCallback((kind: ActivityKind) => {
		const now = Date.now();
		const prev = last.current[kind];
		if (prev !== undefined && now - prev < ACTIVITY_INTERVALS[kind]) return;
		last.current[kind] = now;
		try {
			captureActivity().catch(() => {});
		} catch {
			// Sin IPC disponible: el vigilante decidirá, no el frontend.
		}
	}, []);

	useEffect(() => {
		const onMouseDown = () => notify("mousedown");
		const onMouseMove = () => notify("mousemove");
		const onKeyDown = () => notify("keydown");
		document.addEventListener("mousedown", onMouseDown, true);
		document.addEventListener("mousemove", onMouseMove, true);
		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			document.removeEventListener("mousedown", onMouseDown, true);
			document.removeEventListener("mousemove", onMouseMove, true);
			document.removeEventListener("keydown", onKeyDown, true);
		};
	}, [notify]);

	return notify;
}
