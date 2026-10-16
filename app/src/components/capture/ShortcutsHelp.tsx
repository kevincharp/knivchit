import { TOOL_BINDINGS } from "./toolShortcuts";

const OTHER: [string, string][] = [
	["Ctrl+Z · Ctrl+Shift+Z", "Deshacer · rehacer"],
	["Supr", "Borrar la anotación elegida"],
	["Ctrl+C · Enter", "Copiar y cerrar"],
	["Ctrl+S", "Guardar"],
	["Ctrl+Shift+S", "Guardar como…"],
	["Esc", "Deseleccionar o cancelar"],
	["?", "Mostrar u ocultar esta ayuda"],
];

/**
 * Ayuda breve de los atajos del editor. Usa la superficie clara de la toolbar
 * (mismos tokens) y `data-capture-toolbar` para conservar clic y cursor normales.
 */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
	return (
		<section
			data-capture-toolbar
			aria-label="Atajos del editor"
			className="absolute top-1/2 left-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-ui)] border border-[var(--color-pill-border)] bg-[var(--color-pill)] p-4 text-[var(--color-pill-ink)]"
		>
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold text-[var(--color-toolbar-icon)]">
					Atajos del editor
				</h2>
				<button
					type="button"
					aria-label="Cerrar ayuda"
					title="Cerrar ayuda"
					onClick={onClose}
					className="h-7 rounded-full px-3 text-xs hover:bg-[var(--color-pill-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
				>
					Cerrar
				</button>
			</div>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
				{TOOL_BINDINGS.map((b) => (
					<div key={b.tool} className="contents">
						<dt className="text-[var(--color-toolbar-icon)]">{b.label}</dt>
						<dd className="m-0">
							<kbd className="font-sans">Alt+{b.alt}</kbd>
							{b.plain.map((p) => (
								<span key={p}>
									{" · "}
									<kbd className="font-sans">{p}</kbd>
								</span>
							))}
						</dd>
					</div>
				))}
				<div className="col-span-2 my-1 h-px bg-[var(--color-pill-divider)]" />
				{OTHER.map(([keys, what]) => (
					<div key={keys} className="contents">
						<dt className="text-[var(--color-toolbar-icon)]">{what}</dt>
						<dd className="m-0">
							<kbd className="font-sans">{keys}</kbd>
						</dd>
					</div>
				))}
			</dl>
			<p className="mt-3 text-xs text-[var(--color-pill-ink)]">
				La letra sola no actúa mientras escribes un texto; Alt+letra sí.
			</p>
		</section>
	);
}
