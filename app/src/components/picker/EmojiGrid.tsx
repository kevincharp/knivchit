import { useEffect } from "react";
import type { Emoji } from "../../lib/emoji/types";

interface EmojiGridProps {
	emojis: readonly Emoji[];
	selected: number;
	onPick: (char: string) => void;
}

export function EmojiGrid({ emojis, selected, onPick }: EmojiGridProps) {
	useEffect(() => {
		document.getElementById(`emoji-${selected}`)?.scrollIntoView({
			block: "nearest",
		});
	}, [selected]);

	if (emojis.length === 0) {
		return (
			<p className="p-6 text-center text-sm text-[var(--color-fg-muted)]">
				Sin resultados
			</p>
		);
	}
	return (
		<div
			role="listbox"
			aria-label="Emojis"
			aria-activedescendant={`emoji-${selected}`}
			tabIndex={0}
			className="grid min-h-0 flex-1 grid-cols-8 content-start gap-0.5 overflow-y-auto p-2 outline-none"
		>
			{emojis.map((emoji, i) => (
				<button
					// biome-ignore lint/suspicious/noArrayIndexKey: los recientes repiten emojis de la lista
					key={i}
					id={`emoji-${i}`}
					type="button"
					role="option"
					tabIndex={-1}
					aria-selected={i === selected}
					title={emoji.name}
					onClick={() => onPick(emoji.char)}
					className={`flex h-8 items-center justify-center rounded-[var(--radius-sharp)] border text-xl ${
						i === selected
							? "border-[var(--color-accent)] bg-[var(--color-card-hover)]"
							: "border-transparent hover:bg-[var(--color-card-hover)]"
					}`}
				>
					{emoji.char}
				</button>
			))}
		</div>
	);
}
