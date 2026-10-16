import { useCallback, useEffect, useRef, useState } from "react";
import {
	type CaptureErrorCode,
	type CapturePermissionState,
	captureErrorCode,
	getCapturePermission,
	onCapturePermissionChanged,
	requestCapturePermission,
} from "../../lib/tauri";

/**
 * Estado del permiso de captura de GNOME para la tarjeta de captura:
 * - loading: aún no se sabe;
 * - granted: concedido, sin aviso;
 * - pending: falta concederlo (el aviso pide pulsar «Permitir capturas»);
 * - denied / cancelled / unavailable: el portal lo rechazó, se cerró el aviso sin decidir o no hay portal;
 * - error: no se pudo ni comprobar.
 */
export type CapturePermissionStatus =
	| "loading"
	| "granted"
	| "pending"
	| "denied"
	| "cancelled"
	| "unavailable"
	| "error";

export function statusOf(
	state: CapturePermissionState,
): CapturePermissionStatus {
	if (state.granted) return "granted";
	switch (state.last_error) {
		case "denied":
			return "denied";
		case "cancelled":
			return "cancelled";
		case "portal_unavailable":
			return "unavailable";
		default:
			return "pending";
	}
}

function statusOfCode(code: CaptureErrorCode): CapturePermissionStatus {
	return statusOf({ granted: false, last_error: code });
}

export interface CapturePermission {
	status: CapturePermissionStatus;
	/** Hay una petición de permiso en curso (el aviso del portal está abierto). */
	requesting: boolean;
	/** Pide el permiso: GNOME muestra su aviso a la ventana con foco. */
	request: () => Promise<void>;
	/** Refleja un rechazo de otra orden (p. ej. `start_capture`); `false` si no era un código de permiso. */
	report: (error: unknown) => boolean;
}

/** Lee el permiso, lo mantiene al día con los eventos del backend (sin polling) y lo pide. */
export function useCapturePermission(): CapturePermission {
	const [status, setStatus] = useState<CapturePermissionStatus>("loading");
	const [requesting, setRequesting] = useState(false);
	const asking = useRef(false);

	useEffect(() => {
		let alive = true;
		let stop: (() => void) | undefined;
		getCapturePermission()
			.then((s) => alive && setStatus(statusOf(s)))
			.catch(() => alive && setStatus("error"));
		onCapturePermissionChanged((s) => alive && setStatus(statusOf(s)))
			.then((unlisten) => {
				if (alive) stop = unlisten;
				else unlisten();
			})
			.catch(() => {});
		return () => {
			alive = false;
			stop?.();
		};
	}, []);

	const request = useCallback(async () => {
		if (asking.current) return;
		asking.current = true;
		setRequesting(true);
		try {
			await requestCapturePermission();
			setStatus("granted");
		} catch (e) {
			// «busy»: el backend ya tiene una petición en curso (la que abrió el aviso);
			// no es un resultado, así que no cambia el estado.
			if ((e instanceof Error ? e.message : String(e)) === "busy") return;
			const code = captureErrorCode(e);
			setStatus(code ? statusOfCode(code) : "error");
		} finally {
			asking.current = false;
			setRequesting(false);
		}
	}, []);

	const report = useCallback((error: unknown) => {
		const code = captureErrorCode(error);
		if (!code) return false;
		setStatus(statusOfCode(code));
		return true;
	}, []);

	return { status, requesting, request, report };
}
