import type { Tool } from "./annotationPalette";
import type { AnnotationHandleId } from "./annotations";

/** Qué hay bajo el puntero, para elegir el cursor. */
export type CursorHit =
	| { kind: "none" }
	| { kind: "annotation" }
	| { kind: "handle"; handle: AnnotationHandleId };

export const NO_HIT: CursorHit = { kind: "none" };

/**
 * Cursor del extremo de una flecha: uno propio (un nodo), no una flecha de
 * redimensión, porque el extremo se mueve libremente en 2D; la manita (`grab`)
 * queda para desplazar la figura entera. Las esquinas de rectángulo y elipse sí tienen dirección.
 */
function handleCursor(handle: AnnotationHandleId): string {
	switch (handle) {
		case "nw":
		case "se":
			return "nwse-resize";
		case "ne":
		case "sw":
			return "nesw-resize";
		case "n":
		case "s":
			return "ns-resize";
		case "e":
		case "w":
			return "ew-resize";
		default:
			return cursorCss("endpoint");
	}
}

/**
 * Cursor de la superficie de dibujo según la herramienta, lo que hay debajo y
 * si hay un gesto en curso. Cada herramienta de dibujo tiene su cursor propio
 * (TOOL_CURSORS, con cursor de sistema de respaldo); Seleccionar usa siempre los
 * del sistema, que siguen el tema del escritorio. Pura: sin DOM ni estado.
 */
export function cursorFor(
	tool: Tool | null,
	hit: CursorHit,
	dragging: boolean,
): string {
	switch (tool) {
		case null:
			return "default";
		case "select":
			if (hit.kind === "none") return "default";
			if (dragging) return "grabbing";
			return hit.kind === "handle" ? handleCursor(hit.handle) : "grab";
		default:
			// rect, ellipse, arrow, pen, text, mosaic, eraser
			return cursorCss(tool);
	}
}

// ───────────── Juego de cursores propios por herramienta (propuesta) ─────────────

export type ToolCursorId =
	| "eraser"
	| "mosaic"
	| "pen"
	| "arrow"
	| "rect"
	| "ellipse"
	| "text"
	| "endpoint";

export interface CursorDef {
	/** SVG de `px` × `px` (vectorial: sirve para 1x y 2x). */
	svg: (px: number) => string;
	/** Lado del cursor a 1x; WebKitGTK/Wayland limita los cursores grandes. */
	size: number;
	/** Punto activo, en píxeles a 1x. */
	hotspot: [number, number];
	/** Cursor del sistema si el SVG no carga o no se admite. */
	fallback: string;
}

export const MAX_CURSOR_SIZE = 32;

const wrap = (inner: string) => (px: number) =>
	`<svg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 32 32' fill='none' stroke-linecap='round' stroke-linejoin='round'>${inner}</svg>`;

// Silueta oscura con contorno blanco de 1 px: se lee sobre fondos claros y oscuros.
const line = (d: string) =>
	`<path d='${d}' stroke='white' stroke-width='4'/><path d='${d}' stroke='black' stroke-width='1.6'/>`;
const solid = (d: string) =>
	`<path d='${d}' fill='black' stroke='white' stroke-width='1.6'/>`;
const CROSS = line("M4 16h9M19 16h9M16 4v9M16 19v9");

export const TOOL_CURSORS: Record<ToolCursorId, CursorDef> = {
	eraser: {
		svg: wrap(
			"<g transform='rotate(-40 16 16)'>" +
				solid(
					"M9 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z",
				) +
				"<path d='M9 11h7v10H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z' fill='white' stroke='black' stroke-width='1.4'/></g>",
		),
		size: 32,
		hotspot: [9, 22],
		fallback: "cell",
	},
	mosaic: {
		svg: wrap(
			line("M16 3v4M16 25v4M3 16h4M25 16h4") +
				"<rect x='10' y='10' width='12' height='12' stroke='white' stroke-width='4'/>" +
				"<rect x='10' y='10' width='12' height='12' fill='white' stroke='black' stroke-width='1.4'/>" +
				"<path d='M10 10h4v4h-4ZM18 10h4v4h-4ZM14 14h4v4h-4ZM10 18h4v4h-4ZM18 18h4v4h-4Z' fill='black'/>",
		),
		size: 32,
		hotspot: [16, 16],
		fallback: "crosshair",
	},
	pen: {
		svg: wrap(
			solid("M4 28L7 19L22 4L28 10L13 25Z") +
				"<path d='M7 19L13 25M19 7L25 13' stroke='white' stroke-width='1.2'/>",
		),
		size: 32,
		hotspot: [4, 28],
		fallback: "crosshair",
	},
	arrow: {
		svg: wrap(CROSS + line("M21 29L29 21M29 21H24M29 21V26")),
		size: 32,
		hotspot: [16, 16],
		fallback: "crosshair",
	},
	rect: {
		svg: wrap(CROSS + line("M21 22h8v6h-8Z")),
		size: 32,
		hotspot: [16, 16],
		fallback: "crosshair",
	},
	ellipse: {
		svg: wrap(CROSS + line("M20.5 25a4.5 3.5 0 1 0 9 0a4.5 3.5 0 1 0 -9 0Z")),
		size: 32,
		hotspot: [16, 16],
		fallback: "crosshair",
	},
	// Extremo de una flecha en edición: un nodo (aro con punto), distinto de la cruz de dibujo.
	endpoint: {
		svg: wrap(
			"<circle cx='16' cy='16' r='7' stroke='white' stroke-width='4'/>" +
				"<circle cx='16' cy='16' r='7' stroke='black' stroke-width='1.6'/>" +
				"<circle cx='16' cy='16' r='2' fill='black' stroke='white' stroke-width='1'/>",
		),
		size: 32,
		hotspot: [16, 16],
		fallback: "crosshair",
	},
	text: {
		svg: wrap(line("M11 5h10M16 5v22M11 27h10")),
		size: 32,
		hotspot: [16, 16],
		fallback: "text",
	},
};

const dataUri = (svg: string) =>
	`url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

let imageSetOk: boolean | undefined;
function supportsImageSet(): boolean {
	if (imageSetOk === undefined) {
		imageSetOk =
			typeof CSS !== "undefined" &&
			typeof CSS.supports === "function" &&
			CSS.supports("cursor", "image-set(url(a.png) 1x) 0 0, auto");
	}
	return imageSetOk;
}

/** Valor CSS de `cursor`: `image-set` 1x/2x si se admite, con el hotspot y el cursor de sistema de respaldo siempre. */
export function cursorCss(id: ToolCursorId): string {
	const d = TOOL_CURSORS[id];
	const [x, y] = d.hotspot;
	const image = supportsImageSet()
		? `image-set(${dataUri(d.svg(d.size))} 1x, ${dataUri(d.svg(d.size * 2))} 2x)`
		: dataUri(d.svg(d.size));
	return `${image} ${x} ${y}, ${d.fallback}`;
}
