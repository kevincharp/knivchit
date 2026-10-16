/** Atajo como chip de teclas: `keys` se dibuja como `<kbd>` separados por «+». */
export function ShortcutChip({ keys }: { keys: string[] }) {
	return (
		<span className="inline-flex flex-wrap items-center gap-1 text-[var(--color-fg-muted)]">
			{keys.map((k, i) => (
				<span key={k} className="inline-flex items-center gap-1">
					{i > 0 && <span aria-hidden="true">+</span>}
					<kbd className="rounded-[var(--radius-sharp)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-1.5 py-0.5 font-sans text-xs text-[var(--color-fg)]">
						{k}
					</kbd>
				</span>
			))}
		</span>
	);
}
