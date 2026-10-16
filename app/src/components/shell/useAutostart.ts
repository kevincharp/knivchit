import { useCallback, useEffect, useState } from "react";
import { getAutostart, setAutostart } from "../../lib/tauri";

/** Arranque con la sesión: lectura inicial y cambio con reversión si el backend no puede escribir. */
export function useAutostart() {
	const [enabled, setEnabled] = useState<boolean | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		getAutostart()
			.then((v) => alive && setEnabled(v))
			.catch((e) => alive && setError(String(e)));
		return () => {
			alive = false;
		};
	}, []);

	const change = useCallback(async (next: boolean) => {
		setError(null);
		setEnabled(next);
		try {
			await setAutostart(next);
		} catch (e) {
			setEnabled(!next);
			setError(String(e));
		}
	}, []);

	return { enabled, error, change };
}
