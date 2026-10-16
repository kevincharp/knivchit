import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useRef, useState } from "react";
import {
	copyCapture,
	pinCapture,
	saveCapture,
	saveCaptureAs,
} from "../../lib/tauri";
import type { Annotation } from "./annotations";
import { composeCapture } from "./renderAnnotations";
import type { Rect } from "./selection";

export type OutputKind = "copy" | "save" | "save-as" | "pin";

interface Params {
	image: HTMLImageElement | null;
	selection: Rect | null;
	annotations: Annotation[];
	/** Píxeles de pantalla por píxel de imagen, para el tamaño lógico del pin. */
	scale: { x: number; y: number };
}

/**
 * Salida de la captura: compone el PNG (recorte nativo + anotaciones), lo manda
 * al backend y cierra la ventana. Si algo falla deja el overlay abierto y
 * expone el mensaje en `error`.
 */
export function useCaptureOutput({
	image,
	selection,
	annotations,
	scale,
}: Params) {
	const [busy, setBusy] = useState(false);
	// Candado síncrono: `busy` es estado y dos llamadas seguidas ven el valor viejo.
	const inFlight = useRef(false);
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(
		async (kind: OutputKind) => {
			if (
				!image ||
				!selection ||
				selection.w < 1 ||
				selection.h < 1 ||
				inFlight.current
			) {
				return;
			}
			inFlight.current = true;
			setBusy(true);
			setError(null);
			try {
				const png = await composeCapture(image, selection, annotations);
				if (kind === "copy") {
					await copyCapture(png);
				} else if (kind === "save") {
					await saveCapture(png);
				} else if (kind === "save-as") {
					// null = el usuario canceló el diálogo nativo: la captura sigue
					// pendiente, el overlay no se cierra y se puede reintentar.
					if ((await saveCaptureAs(png)) === null) {
						setBusy(false);
						return;
					}
				} else {
					await pinCapture(png, selection.w * scale.x, selection.h * scale.y);
				}
				await getCurrentWindow().close();
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
				setBusy(false);
			} finally {
				inFlight.current = false;
			}
		},
		[image, selection, annotations, scale.x, scale.y],
	);

	return { run, busy, error };
}
