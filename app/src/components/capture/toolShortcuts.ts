import type { Tool } from "./annotationPalette";

/**
 * Atajos para cambiar de herramienta dentro del overlay. Son locales (no
 * globales, no chocan con el sistema), así que sí llevan valores por defecto.
 * `alt`: Alt+letra, funciona siempre, incluso escribiendo un texto.
 * `plain`: la letra sola, solo cuando no se está escribiendo.
 * Las letras se reconocen por la tecla física (`code`), no por el carácter,
 * para que funcionen igual en cualquier distribución de teclado.
 */
export interface ToolBinding {
	tool: Tool;
	label: string;
	alt: string;
	plain: string[];
}

export const TOOL_BINDINGS: ToolBinding[] = [
	{ tool: "select", label: "Seleccionar", alt: "H", plain: ["H", "V"] },
	{ tool: "rect", label: "Rectángulo", alt: "R", plain: ["R"] },
	{ tool: "ellipse", label: "Elipse", alt: "O", plain: ["O"] },
	{ tool: "arrow", label: "Flecha", alt: "F", plain: ["F"] },
	{ tool: "pen", label: "Lápiz", alt: "L", plain: ["L"] },
	{ tool: "text", label: "Texto", alt: "T", plain: ["T"] },
	{ tool: "mosaic", label: "Mosaico", alt: "M", plain: ["M"] },
	{ tool: "eraser", label: "Borrador", alt: "B", plain: ["B"] },
];

type KeyLike = Pick<
	KeyboardEvent,
	"code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"
>;

/**
 * Herramienta que pide una pulsación, o `null`. Ctrl y Meta nunca (Ctrl+C,
 * Ctrl+S… son de otros atajos); Alt+Shift tampoco. Con `editingText`, solo
 * vale Alt+letra: la letra sola es texto.
 */
export function toolForKey(e: KeyLike, editingText: boolean): Tool | null {
	if (e.ctrlKey || e.metaKey) return null;
	const m = /^Key([A-Z])$/.exec(e.code);
	if (!m) return null;
	const letter = m[1];
	if (e.altKey) {
		if (e.shiftKey) return null;
		return TOOL_BINDINGS.find((b) => b.alt === letter)?.tool ?? null;
	}
	if (editingText || e.shiftKey) return null;
	return TOOL_BINDINGS.find((b) => b.plain.includes(letter))?.tool ?? null;
}

function binding(tool: Tool): ToolBinding | undefined {
	return TOOL_BINDINGS.find((b) => b.tool === tool);
}

/** `Alt+F · F` para tooltips y listas. */
export function toolShortcutLabel(tool: Tool): string {
	const b = binding(tool);
	if (!b) return "";
	return [`Alt+${b.alt}`, ...b.plain].join(" · ");
}

/** Valor de `aria-keyshortcuts`: alternativas separadas por espacios. */
export function toolAriaKeyShortcuts(tool: Tool): string {
	const b = binding(tool);
	return b ? [`Alt+${b.alt}`, ...b.plain].join(" ") : "";
}
