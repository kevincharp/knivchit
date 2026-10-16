/**
 * Geometría pura de la selección (sin DOM). Todo en píxeles de la imagen:
 * el overlay convierte a píxeles de pantalla con `scale` solo al pintar.
 */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Size {
	w: number;
	h: number;
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLE_IDS: HandleId[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];

export const HANDLE_CURSORS: Record<HandleId, string> = {
	nw: "nwse-resize",
	se: "nwse-resize",
	ne: "nesw-resize",
	sw: "nesw-resize",
	n: "ns-resize",
	s: "ns-resize",
	e: "ew-resize",
	w: "ew-resize",
};

/** Posición de cada manija como fracción (0, 0.5, 1) de la selección. */
export const HANDLE_ANCHORS: Record<HandleId, { fx: number; fy: number }> = {
	nw: { fx: 0, fy: 0 },
	n: { fx: 0.5, fy: 0 },
	ne: { fx: 1, fy: 0 },
	e: { fx: 1, fy: 0.5 },
	se: { fx: 1, fy: 1 },
	s: { fx: 0.5, fy: 1 },
	sw: { fx: 0, fy: 1 },
	w: { fx: 0, fy: 0.5 },
};

/** Lado mínimo de una selección válida, en px de imagen. */
export const MIN_SELECTION = 8;

export function rectFromPoints(
	a: { x: number; y: number },
	b: { x: number; y: number },
): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(a.x - b.x),
		h: Math.abs(a.y - b.y),
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Redondea a píxeles enteros de imagen y recorta a los límites. */
export function clampRect(rect: Rect, bounds: Size): Rect {
	const x = clamp(Math.round(rect.x), 0, bounds.w);
	const y = clamp(Math.round(rect.y), 0, bounds.h);
	const right = clamp(Math.round(rect.x + rect.w), 0, bounds.w);
	const bottom = clamp(Math.round(rect.y + rect.h), 0, bounds.h);
	return { x, y, w: right - x, h: bottom - y };
}

/** Desplaza sin cambiar el tamaño; se detiene en los bordes de la imagen. */
export function moveRect(
	rect: Rect,
	dx: number,
	dy: number,
	bounds: Size,
): Rect {
	return {
		x: Math.round(clamp(rect.x + dx, 0, bounds.w - rect.w)),
		y: Math.round(clamp(rect.y + dy, 0, bounds.h - rect.h)),
		w: rect.w,
		h: rect.h,
	};
}

/** Mueve los bordes que toca la manija; respeta el mínimo y los límites, sin voltear. */
export function resizeRect(
	rect: Rect,
	handle: HandleId,
	dx: number,
	dy: number,
	bounds: Size,
	min: number = MIN_SELECTION,
): Rect {
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.w;
	let bottom = rect.y + rect.h;
	if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
	if (handle.includes("e")) right = clamp(right + dx, left + min, bounds.w);
	if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
	if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, bounds.h);
	return {
		x: Math.round(left),
		y: Math.round(top),
		w: Math.round(right) - Math.round(left),
		h: Math.round(bottom) - Math.round(top),
	};
}

export type ToolbarPlacement = "below" | "above" | "inside";

/**
 * Posición (px de pantalla) de la píldora: centrada bajo la selección; si no
 * cabe, encima; si tampoco, dentro de la selección, pegada abajo.
 * `rect` y el resultado están en px de pantalla.
 */
export function placeToolbar(
	rect: Rect,
	toolbar: Size,
	viewport: Size,
	gap = 14,
	margin = 8,
): { left: number; top: number; placement: ToolbarPlacement } {
	const half = toolbar.w / 2;
	const left = clamp(
		rect.x + rect.w / 2,
		half + margin,
		viewport.w - half - margin,
	);
	const below = rect.y + rect.h + gap;
	if (below + toolbar.h <= viewport.h - margin) {
		return { left, top: below, placement: "below" };
	}
	const above = rect.y - gap - toolbar.h;
	if (above >= margin) return { left, top: above, placement: "above" };
	return {
		left,
		top: Math.max(margin, rect.y + rect.h - gap - toolbar.h),
		placement: "inside",
	};
}
