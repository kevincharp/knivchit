import { acceleratorChips } from "../../lib/shortcut";
import { ShortcutChip } from "./ShortcutChip";

/** El atajo como chips de teclas, o «Sin asignar». El texto accesible es la combinación entera. */
export function ShortcutValue({ accel }: { accel: string | null | undefined }) {
	const keys = acceleratorChips(accel);
	if (!keys.length) {
		return (
			<span className="text-xs text-[var(--color-fg-muted)]">Sin asignar</span>
		);
	}
	return (
		<span role="img" aria-label={keys.join(" + ")}>
			<ShortcutChip keys={keys} />
		</span>
	);
}
