import { useCallback, useEffect, useState } from "react";
import {
	chooseSaveDir,
	getSettings,
	type Settings,
	updateSettings,
} from "../../lib/tauri";

// Sembrado por la migración inicial (ver db/migrations.rs): vale hasta que el
// usuario confirma una carpeta por primera vez.
export const PLACEHOLDER_SCREENSHOT_DIR = "__PLACEHOLDER__";
export const DEFAULT_SCREENSHOT_DIR = "~/Pictures/Screenshots";

/** Carpeta de guardado de capturas: lectura, cambio con el selector y confirmación de la predeterminada. */
export function useSaveDir() {
	const [settings, setSettings] = useState<Settings | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		getSettings()
			.then((s) => alive && setSettings(s))
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
			? DEFAULT_SCREENSHOT_DIR
			: settings.screenshot_save_dir;

	return {
		loaded: settings !== null,
		/** Ruta que se usará al guardar (la predeterminada mientras sea el primer uso). */
		dir,
		firstRun,
		error,
		choose,
		useDefault: () => save(DEFAULT_SCREENSHOT_DIR),
	};
}
