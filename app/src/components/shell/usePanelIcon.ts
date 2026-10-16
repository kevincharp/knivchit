import { useCallback, useEffect, useState } from "react";
import { getPanelIcon, setPanelIcon } from "../../lib/tauri";
import {
	extensionErrorCode,
	extensionErrorMessage,
	INACTIVE_MESSAGE,
} from "./extensionErrors";

export type PanelIconStatus = "loading" | "ready" | "unavailable";

/**
 * Icono opcional de la barra superior: lo muestra la extensión; la app lo lee y
 * lo cambia por el backend. Por defecto está ACTIVADO (así se ve mientras carga).
 * Sin extensión, o si esta rechaza el cambio por una causa que activarla no
 * arregla, el interruptor queda desactivado con el motivo; cualquier otro fallo
 * al guardar revierte el valor y lo cuenta.
 */
export function usePanelIcon() {
	const [status, setStatus] = useState<PanelIconStatus>("loading");
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		getPanelIcon()
			.then((info) => {
				if (!alive) return;
				if (info.extension_active) {
					setEnabled(info.enabled);
					setStatus("ready");
				} else {
					setError(INACTIVE_MESSAGE);
					setStatus("unavailable");
				}
			})
			.catch((e) => {
				if (!alive) return;
				setError(extensionErrorMessage(e));
				setStatus("unavailable");
			});
		return () => {
			alive = false;
		};
	}, []);

	const change = useCallback(async (next: boolean) => {
		setError(null);
		setEnabled(next);
		try {
			await setPanelIcon(next);
		} catch (e) {
			setEnabled(!next);
			setError(extensionErrorMessage(e));
			if (extensionErrorCode(e) !== null) setStatus("unavailable");
		}
	}, []);

	return { status, enabled, error, change };
}
