import { type KeyboardEvent, useRef } from "react";
import type { Feature } from "./features";
import { SidebarItem } from "./SidebarItem";

interface SidebarProps {
	features: Feature[];
	current: string;
	onSelect: (id: string) => void;
}

/**
 * Barra lateral de secciones. Arriba las funciones, abajo configuración y
 * acerca de. Tab recorre los botones; ↑/↓ mueven el foco entre ellos.
 */
export function Sidebar({ features, current, onSelect }: SidebarProps) {
	const ref = useRef<HTMLElement>(null);

	function onKeyDown(e: KeyboardEvent) {
		if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
		const buttons = Array.from(
			ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
		);
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (at === -1) return;
		e.preventDefault();
		const step = e.key === "ArrowDown" ? 1 : -1;
		buttons[(at + step + buttons.length) % buttons.length].focus();
	}

	const group = (g: Feature["group"]) => features.filter((f) => f.group === g);

	return (
		<nav
			ref={ref}
			aria-label="Secciones"
			onKeyDown={onKeyDown}
			className="flex w-[88px] shrink-0 flex-col items-center justify-between bg-[var(--color-side)] py-2.5"
		>
			<ul className="m-0 flex list-none flex-col items-center gap-1 p-0">
				{group("main").map((f) => (
					<li key={f.id}>
						<SidebarItem
							feature={f}
							active={f.id === current}
							onSelect={onSelect}
						/>
					</li>
				))}
			</ul>
			<ul className="m-0 flex w-[78px] list-none flex-col items-center gap-1 border-t border-[var(--color-card-border)] p-0 pt-2.5">
				{group("footer").map((f) => (
					<li key={f.id}>
						<SidebarItem
							feature={f}
							active={f.id === current}
							onSelect={onSelect}
						/>
					</li>
				))}
			</ul>
		</nav>
	);
}
