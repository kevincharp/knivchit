import { useState } from "react";
import { openSaveDir } from "../../lib/tauri";
import { Button } from "./Button";
import { Card } from "./Card";

export function SaveDirCard({ dir }: { dir: string | null }) {
	const [error, setError] = useState<string | null>(null);

	async function open() {
		if (!dir) return;
		setError(null);
		try {
			await openSaveDir();
		} catch (e) {
			setError(`No se pudo abrir la carpeta: ${String(e)}`);
		}
	}

	return (
		<Card aria-labelledby="savedir-title" className="flex flex-col gap-2">
			<h2 id="savedir-title" className="text-sm font-semibold">
				Carpeta de guardado
			</h2>
			<p
				title={dir ?? undefined}
				className="truncate font-mono text-xs text-[var(--color-fg-muted)]"
			>
				{dir ?? "Cargando…"}
			</p>
			<div>
				<Button onClick={open} disabled={!dir}>
					Abrir carpeta
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
					{error}
				</p>
			)}
		</Card>
	);
}
