/**
 * Atajos globales: formato legible de un acelerador GTK (`<Super><Shift>c`, el
 * que guarda la extensión en GSettings). La grabación la hace la extensión con
 * un grab modal (`recordShortcut`): WebKitGTK no refleja Super en `metaKey` y
 * las combinaciones que Mutter ya tiene ligadas no llegan a la ventana.
 */

const MOD_LABEL: Record<string, string> = {
	Super: "Super",
	Primary: "Ctrl",
	Control: "Ctrl",
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
};

const KEY_LABEL: Record<string, string> = {
	space: "Espacio",
	Return: "Enter",
	BackSpace: "Retroceso",
	Page_Up: "Re Pág",
	Page_Down: "Av Pág",
	Up: "↑",
	Down: "↓",
	Left: "←",
	Right: "→",
	minus: "-",
	equal: "=",
	comma: ",",
	period: ".",
	slash: "/",
	backslash: "\\",
	semicolon: ";",
	apostrophe: "'",
	grave: "`",
	bracketleft: "[",
	bracketright: "]",
	Print: "Impr Pant",
};

/** `<Super><Shift>c` → `["Super", "Shift", "C"]`. Vacío o inválido → `[]`. */
export function acceleratorChips(accel: string | null | undefined): string[] {
	if (!accel) return [];
	const match = /^((?:<[A-Za-z]+>)*)(.+)$/.exec(accel);
	if (!match) return [];
	const mods = [...match[1].matchAll(/<([A-Za-z]+)>/g)].map(
		(m) => MOD_LABEL[m[1]] ?? m[1],
	);
	const raw = match[2];
	const key = KEY_LABEL[raw] ?? (raw.length === 1 ? raw.toUpperCase() : raw);
	return [...mods, key];
}

/** `Super+Shift+C` para textos y aria-label. */
export function acceleratorLabel(accel: string | null | undefined): string {
	return acceleratorChips(accel).join("+");
}

/** El atajo que se ofrece como sugerencia (nunca se aplica solo). */
export const SUGGESTED_CAPTURE_ACCEL = "<Super><Shift>c";
