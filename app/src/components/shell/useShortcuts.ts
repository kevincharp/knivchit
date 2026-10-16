import { useCallback, useEffect, useState } from "react";
import {
	checkShortcutConflicts,
	getShortcuts,
	recordShortcut,
	setShortcut,
} from "../../lib/tauri";
import {
	extensionErrorMessage as message,
	OUTDATED_MESSAGE,
	SHORTCUTS_UNAVAILABLE_MESSAGE,
} from "./extensionErrors";

export { OUTDATED_MESSAGE, SHORTCUTS_UNAVAILABLE_MESSAGE };

export const CAPTURE_ACTION = "capture";

export type ShortcutsStatus = "loading" | "ready" | "unavailable" | "outdated";

/** Atajos globales: los guarda la extensión; la app los lee y cambia por el backend. */
export function useShortcuts() {
	const [status, setStatus] = useState<ShortcutsStatus>("loading");
	const [extensionActive, setExtensionActive] = useState(false);
	const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const s = await getShortcuts();
			setExtensionActive(s.extension_active);
			setShortcuts(s.shortcuts ?? {});
			setStatus("ready");
		} catch (e) {
			setExtensionActive(false);
			setShortcuts({});
			setStatus(
				(e instanceof Error ? e.message : String(e)) === "extension_outdated"
					? "outdated"
					: "unavailable",
			);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	/** Asigna (o quita con `null`). Devuelve si se aplicó; el motivo queda en `error`. */
	const assign = useCallback(
		async (action: string, accel: string | null) => {
			setError(null);
			try {
				await setShortcut(action, accel);
				await refresh();
				return true;
			} catch (e) {
				setError(message(e));
				return false;
			}
		},
		[refresh],
	);

	/** Conflictos del acelerador; lanza con un texto legible si no se pudo comprobar. */
	const conflicts = useCallback(async (accel: string) => {
		try {
			return await checkShortcutConflicts(accel);
		} catch (e) {
			throw new Error(message(e));
		}
	}, []);

	/** La extensión graba la combinación (grab modal); lanza con un texto legible si falla. */
	const record = useCallback(async () => {
		try {
			return await recordShortcut();
		} catch (e) {
			throw new Error(message(e));
		}
	}, []);

	return {
		status,
		extensionActive,
		shortcuts,
		capture: shortcuts[CAPTURE_ACTION] || null,
		error,
		assign,
		conflicts,
		record,
	};
}
