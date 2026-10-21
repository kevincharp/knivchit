import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import data from "../../lib/emoji/emoji-data.json";
import { searchEmojis } from "../../lib/emoji/search";
import type { Emoji } from "../../lib/emoji/types";
import { EmojiGrid } from "./EmojiGrid";

const EMOJIS = data as Emoji[];
const COLUMNS = 8;
const CATEGORIES = [
	{ group: "Smileys & Emotion", label: "Caras y emociones", icon: "😀" },
	{ group: "People & Body", label: "Personas", icon: "👋" },
	{ group: "Animals & Nature", label: "Animales y naturaleza", icon: "🐱" },
	{ group: "Food & Drink", label: "Comida y bebida", icon: "🍔" },
	{ group: "Travel & Places", label: "Viajes y lugares", icon: "✈️" },
	{ group: "Activities", label: "Actividades", icon: "⚽" },
	{ group: "Objects", label: "Objetos", icon: "💡" },
	{ group: "Symbols", label: "Símbolos", icon: "❤️" },
	{ group: "Flags", label: "Banderas", icon: "🏁" },
];

interface EmojiTabProps {
	query: string;
	onQueryChange: (query: string) => void;
	recents: readonly string[];
	focusToken: number;
	onPick: (char: string) => void;
}

export function EmojiTab({
	query,
	onQueryChange,
	recents,
	focusToken,
	onPick,
}: EmojiTabProps) {
	const [group, setGroup] = useState<string | null>(null);
	const [selected, setSelected] = useState(0);
	const searchRef = useRef<HTMLInputElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: focusToken solo fuerza devolver el foco
	useEffect(() => {
		searchRef.current?.focus();
	}, [focusToken]);

	const emojis = useMemo(() => {
		if (query.trim()) return searchEmojis(EMOJIS, query);
		if (group) return EMOJIS.filter((e) => e.group === group);
		const recentEmojis = recents
			.map((char) => EMOJIS.find((e) => e.char === char))
			.filter((e): e is Emoji => e !== undefined);
		return [...recentEmojis, ...EMOJIS];
	}, [query, group, recents]);

	const move = (delta: number) =>
		setSelected((i) => Math.max(0, Math.min(emojis.length - 1, i + delta)));

	const onKeyDown = (e: KeyboardEvent) => {
		if ((e.target as HTMLElement).closest('[role="toolbar"]')) return;
		const delta = {
			ArrowRight: 1,
			ArrowLeft: -1,
			ArrowDown: COLUMNS,
			ArrowUp: -COLUMNS,
		}[e.key];
		if (delta !== undefined) {
			e.preventDefault();
			move(delta);
		} else if (e.key === "Enter" && emojis[selected]) {
			e.preventDefault();
			onPick(emojis[selected].char);
		}
	};

	const onCategoryKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
		if (step === undefined) return;
		const buttons = Array.from(e.currentTarget.querySelectorAll("button"));
		const next = buttons.indexOf(e.target as HTMLButtonElement) + step;
		buttons[(next + buttons.length) % buttons.length].focus();
	};

	const changeQuery = (value: string) => {
		setSelected(0);
		onQueryChange(value);
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: recoge las flechas y Enter que nacen del buscador y la lista
		<div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
			<input
				ref={searchRef}
				type="search"
				value={query}
				onChange={(e) => changeQuery(e.target.value)}
				placeholder="Buscar emoji"
				aria-label="Buscar emoji"
				className="m-2 rounded-[var(--radius-sharp)] border border-[var(--color-card-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]"
			/>
			<div
				role="toolbar"
				aria-label="Categorías"
				onKeyDown={onCategoryKeyDown}
				className="flex justify-between px-2 pb-1"
			>
				{CATEGORIES.map((c, i) => (
					<button
						key={c.group}
						type="button"
						tabIndex={i === 0 ? 0 : -1}
						aria-label={c.label}
						aria-pressed={group === c.group}
						title={c.label}
						onClick={() => {
							setGroup(group === c.group ? null : c.group);
							setSelected(0);
						}}
						className={`h-7 w-7 rounded-[var(--radius-sharp)] text-base ${
							group === c.group
								? "bg-[var(--color-card-hover)] ring-1 ring-[var(--color-accent)]"
								: "hover:bg-[var(--color-card-hover)]"
						}`}
					>
						{c.icon}
					</button>
				))}
			</div>
			<EmojiGrid emojis={emojis} selected={selected} onPick={onPick} />
		</div>
	);
}
