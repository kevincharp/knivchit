import { useCallback, useEffect, useState } from "react";
import {
	chooseSaveDir,
	getDefaultSaveDir,
	getSettings,
	type Settings,
	updateSettings,
} from "../../lib/tauri";

// Sembrado por la migración inicial (ver db/migrations.rs): vale hasta que el
// usuario confirma una carpeta por primera vez.
export const PLACEHOLDER_SCREENSHOT_DIR = "__PLACEHOLDER__";

/** Carpeta de guardado de capturas: lectura, cambio con el selector y confirmación de la predeterminada. */
export function useSaveDir() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [error, setError] = useState<string | null>(null);
	// Carpeta predeterminada de ESTE sistema, resuelta por el backend (idioma y carpeta de Imágenes
	// del usuario): el frontend no lleva una ruta escrita a mano.
	const [defaultDir, setDefaultDir] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		getSettings()
			.then((s) => alive && setSettings(s))
			.catch((e) => alive && setError(String(e)));
		getDefaultSaveDir()
			.then((d) => alive && setDefaultDir(d))
			.catch((e) => alive && setError(String(e)));
		return () => {
			alive = false;
		};
	}, []);

	const save = useCallback(
		async (dir: string) => {
			if (!settings) return;
			setError(null);
			try {
				const next = { ...settings, screenshot_save_dir: dir };
				await updateSettings(next);
				setSettings(next);
			} catch (e) {
				setError(String(e));
			}
		},
		[settings],
	);

	const choose = useCallback(async () => {
		setError(null);
		try {
			const dir = await chooseSaveDir();
			if (dir) await save(dir);
		} catch (e) {
			setError(String(e));
		}
	}, [save]);

	const firstRun = settings?.screenshot_save_dir === PLACEHOLDER_SCREENSHOT_DIR;
	const dir = !settings
		? null
		: firstRun
			? defaultDir
			: settings.screenshot_save_dir;

	return {
		loaded: settings !== null,
		/** Ruta que se usará al guardar (la predeterminada mientras sea el primer uso). */
		dir,
		firstRun,
		error,
		choose,
		useDefault: () => (defaultDir ? save(defaultDir) : Promise.resolve()),
	};
}
