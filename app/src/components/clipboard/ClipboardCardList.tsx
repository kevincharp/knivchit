import { useCallback, useEffect, useState } from "react";
import {
	type ClipboardEntry,
	clearClipboardHistory,
	deleteClipboardEntry,
	getClipboardHistory,
	pinClipboardEntry,
} from "../../lib/tauri";
import { ClipboardCard } from "./ClipboardCard";

/** Lista del historial de portapapeles — carga, estado vacío, y "Borrar todo". */
export function ClipboardCardList() {
	const [entries, setEntries] = useState<ClipboardEntry[]>([]);
	const [loaded, setLoaded] = useState(false);

	const refresh = useCallback(async () => {
		const history = await getClipboardHistory();
		setEntries(history);
		setLoaded(true);
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	async function handlePin(id: string) {
		await pinClipboardEntry(id);
		await refresh();
	}

	async function handleDelete(id: string) {
		await deleteClipboardEntry(id);
		await refresh();
	}

	async function handleClearAll() {
		await clearClipboardHistory();
		await refresh();
	}

	if (!loaded) {
		return <p className="text-sm text-[var(--color-fg-muted)]">Cargando…</p>;
	}

	if (entries.length === 0) {
		return (
			<p className="text-sm text-[var(--color-fg-muted)]">
				Todavía no copiaste nada
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={handleClearAll}
				className="self-end text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
			>
				Borrar todo
			</button>
			{entries.map((entry) => (
				<ClipboardCard
					key={entry.id}
					entry={entry}
					onPin={handlePin}
					onDelete={handleDelete}
				/>
			))}
		</div>
	);
}
