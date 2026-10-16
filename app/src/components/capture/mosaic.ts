import type { Point } from "./annotations";

/** Lado (px de imagen) de cada bloque del mosaico; la rejilla parte del (0,0) de la imagen. */
export const MOSAIC_BLOCK = 10;

/** Diámetro del pincel (px de imagen) = grosor elegido × este factor. */
export const MOSAIC_BRUSH_PER_STROKE = 6;

export interface MosaicCell {
	/** Índice de columna y fila en la rejilla de la imagen. */
	cx: number;
	cy: number;
}

export function mosaicBrushDiameter(strokeWidth: number): number {
	return strokeWidth * MOSAIC_BRUSH_PER_STROKE;
}

/** Descarta puntos casi repetidos (un trazo de ratón da uno cada pocos px) manteniendo siempre el último. */
function thin(points: Point[], minDist: number): Point[] {
	if (points.length <= 2) return points;
	const out = [points[0]];
	for (let i = 1; i < points.length - 1; i++) {
		const last = out[out.length - 1];
		if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) {
			out.push(points[i]);
		}
	}
	out.push(points[points.length - 1]);
	return out;
}

function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 === 0
			? 0
			: Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
	return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * Celdas de la rejilla que cubre un trazo: las que tienen su centro a no más
 * de medio pincel del recorrido, más la celda de cada punto (un toque sin
 * mover siempre pinta algo). Orden estable: por fila y columna.
 */
export function mosaicCells(
	points: Point[],
	diameter: number,
	block: number = MOSAIC_BLOCK,
): MosaicCell[] {
	if (points.length === 0 || diameter <= 0) return [];
	const r = diameter / 2;
	const path = thin(points, block / 2);
	const found = new Map<number, MosaicCell>();
	const add = (cx: number, cy: number) => {
		found.set(cy * 1_000_003 + cx, { cx, cy });
	};
	for (const p of path) add(Math.floor(p.x / block), Math.floor(p.y / block));
	for (let i = 0; i < path.length; i++) {
		const a = path[i];
		const b = path[i + 1] ?? a;
		const x0 = Math.floor((Math.min(a.x, b.x) - r) / block);
		const x1 = Math.floor((Math.max(a.x, b.x) + r) / block);
		const y0 = Math.floor((Math.min(a.y, b.y) - r) / block);
		const y1 = Math.floor((Math.max(a.y, b.y) + r) / block);
		for (let cy = y0; cy <= y1; cy++) {
			for (let cx = x0; cx <= x1; cx++) {
				const mx = (cx + 0.5) * block;
				const my = (cy + 0.5) * block;
				if (distanceToSegment(mx, my, a, b) <= r) add(cx, cy);
			}
		}
	}
	return [...found.values()].sort((p, q) => p.cy - q.cy || p.cx - q.cx);
}

/** Rectángulo (px de imagen) que envuelve las celdas. Sin celdas: `null`. */
export function mosaicBounds(
	cells: MosaicCell[],
	block: number = MOSAIC_BLOCK,
): {
	x: number;
	y: number;
	w: number;
	h: number;
	cols: number;
	rows: number;
} | null {
	if (cells.length === 0) return null;
	let cx0 = Infinity;
	let cy0 = Infinity;
	let cx1 = -Infinity;
	let cy1 = -Infinity;
	for (const c of cells) {
		cx0 = Math.min(cx0, c.cx);
		cy0 = Math.min(cy0, c.cy);
		cx1 = Math.max(cx1, c.cx);
		cy1 = Math.max(cy1, c.cy);
	}
	const cols = cx1 - cx0 + 1;
	const rows = cy1 - cy0 + 1;
	return {
		x: cx0 * block,
		y: cy0 * block,
		w: cols * block,
		h: rows * block,
		cols,
		rows,
	};
}
