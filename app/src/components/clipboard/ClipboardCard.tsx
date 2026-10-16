import { useState } from "react";
import type { ClipboardEntry } from "../../lib/tauri";

interface ClipboardCardProps {
	entry: ClipboardEntry;
	onPin: (id: string) => void;
	onDelete: (id: string) => void;
}

/**
 * Una entrada del historial del portapapeles: su vista previa (o el contenido si
 * no hay) en una línea, la hora, un botón para fijarla arriba y un menú de más
 * opciones con borrar. La tarjeta solo muestra y avisa; fijar y borrar los
 * resuelve quien la usa.
 */
export function ClipboardCard({ entry, onPin, onDelete }: ClipboardCardProps) {
	const [menuOpen, setMenuOpen] = useState(false);

	return (
		<div className="flex items-center gap-2 rounded-[var(--radius-ui)] bg-[var(--color-bg-alt)] p-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm text-[var(--color-fg)]">
					{entry.preview ?? entry.content}
				</p>
				<time className="text-xs text-[var(--color-fg-muted)]">
					{entry.created_at}
				</time>
			</div>
			<button
				type="button"
				aria-label="Fijar"
				aria-pressed={entry.pinned}
				onClick={() => onPin(entry.id)}
				className={
					entry.pinned
						? "text-[var(--color-accent)]"
						: "text-[var(--color-fg-muted)]"
				}
			>
				📌
			</button>
			<div className="relative">
				<button
					type="button"
					aria-label="Más opciones"
					onClick={() => setMenuOpen((open) => !open)}
					className="text-[var(--color-fg-muted)]"
				>
					⋯
				</button>
				{menuOpen && (
					<div className="absolute right-0 z-10 mt-1 rounded-[var(--radius-ui)] bg-[var(--color-bg-alt)] p-1 shadow-lg">
						<button
							type="button"
							onClick={() => {
								onDelete(entry.id);
								setMenuOpen(false);
							}}
							className="whitespace-nowrap px-3 py-1 text-sm text-[var(--color-fg)]"
						>
							Borrar
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
