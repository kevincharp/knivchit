import { useState } from "react";
import { openSaveDir } from "../../lib/tauri";
import { Button } from "./Button";
import { Card } from "./Card";
import { PanelIconCard } from "./PanelIconCard";
import { QuitCard } from "./QuitCard";
import { ShortcutsCard } from "./ShortcutsCard";
import { Switch } from "./Switch";
import { ThemeSelector } from "./ThemeSelector";
import { useAutostart } from "./useAutostart";
import { useSaveDir } from "./useSaveDir";

export function PageSettings() {
	const saveDir = useSaveDir();
	const autostart = useAutostart();
	const [openError, setOpenError] = useState<string | null>(null);

	async function open() {
		setOpenError(null);
		try {
			await openSaveDir();
		} catch (e) {
			setOpenError(`No se pudo abrir la carpeta: ${String(e)}`);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<h1 className="text-lg font-semibold">Configuración</h1>

			<Card aria-labelledby="dir-title" className="flex flex-col gap-2">
				<h2 id="dir-title" className="text-sm font-semibold">
					Carpeta de guardado
				</h2>
				<p
					title={saveDir.dir ?? undefined}
					className="truncate font-mono text-xs text-[var(--color-fg-muted)]"
				>
					{saveDir.dir ?? "Cargando…"}
				</p>
				<p className="text-xs text-[var(--color-fg-muted)]">
					Donde van las capturas al pulsar Guardar.
				</p>
				<div className="flex gap-2">
					<Button onClick={saveDir.choose} disabled={!saveDir.loaded}>
						Cambiar…
					</Button>
					<Button onClick={open} disabled={!saveDir.loaded}>
						Abrir carpeta
					</Button>
				</div>
				{(saveDir.error || openError) && (
					<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
						{saveDir.error ?? openError}
					</p>
				)}
			</Card>

			<ShortcutsCard />

			<Card className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 id="autostart-title" className="text-sm font-semibold">
							Iniciar con la sesión
						</h2>
						<p className="text-xs text-[var(--color-fg-muted)]">
							Knivchit arranca oculto al entrar a tu escritorio.
						</p>
					</div>
					<Switch
						checked={autostart.enabled ?? false}
						onChange={autostart.change}
						labelledBy="autostart-title"
						disabled={autostart.enabled === null}
					/>
				</div>
				{autostart.error && (
					<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
						{autostart.error}
					</p>
				)}
			</Card>

			<PanelIconCard />

			<Card className="flex flex-col gap-2">
				<h2 id="theme-title" className="text-sm font-semibold">
					Apariencia
				</h2>
				<p className="text-xs text-[var(--color-fg-muted)]">
					Sistema sigue la preferencia de GNOME.
				</p>
				<ThemeSelector labelledBy="theme-title" />
			</Card>

			<QuitCard />
		</div>
	);
}
