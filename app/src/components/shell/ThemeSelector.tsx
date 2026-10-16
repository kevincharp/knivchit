import { type KeyboardEvent, useRef } from "react";
import type { ThemeChoice } from "../../lib/theme";
import { useTheme } from "./useTheme";

const OPTIONS: { id: ThemeChoice; label: string }[] = [
	{ id: "system", label: "Sistema" },
	{ id: "dark", label: "Oscuro" },
	{ id: "light", label: "Claro" },
];

/** Radiogrupo de tres opciones. Foco itinerante: Tab entra en la elegida y las flechas cambian de opción. */
export function ThemeSelector({ labelledBy }: { labelledBy: string }) {
	const { choice, setChoice } = useTheme();
	const ref = useRef<HTMLDivElement>(null);

	function onKeyDown(e: KeyboardEvent) {
		const dir =
			e.key === "ArrowRight" || e.key === "ArrowDown"
				? 1
				: e.key === "ArrowLeft" || e.key === "ArrowUp"
					? -1
					: 0;
		if (!dir) return;
		e.preventDefault();
		const at = OPTIONS.findIndex((o) => o.id === choice);
		const next = OPTIONS[(at + dir + OPTIONS.length) % OPTIONS.length];
		setChoice(next.id);
		ref.current
			?.querySelector<HTMLButtonElement>(`[data-choice="${next.id}"]`)
			?.focus();
	}

	return (
		<div
			ref={ref}
			role="radiogroup"
			aria-labelledby={labelledBy}
			onKeyDown={onKeyDown}
			className="grid grid-cols-3 gap-1 rounded-full border border-[var(--color-card-border)] p-1"
		>
			{OPTIONS.map((o) => {
				const on = o.id === choice;
				return (
					// biome-ignore lint/a11y/useSemanticElements: radio estilizado como segmento
					<button
						key={o.id}
						type="button"
						role="radio"
						aria-checked={on}
						data-choice={o.id}
						tabIndex={on ? 0 : -1}
						onClick={() => setChoice(o.id)}
						className={`h-[34px] rounded-full text-[13px] transition-colors duration-[var(--duration-ui)] ease-out focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none ${
							on
								? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]"
								: "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
						}`}
					>
						{o.label}
					</button>
				);
			})}
		</div>
	);
}
