import { describe, expect, it } from "vitest";
import { STROKE_WIDTHS } from "./annotationPalette";
import { type Annotation, hitTest, type Point } from "./annotations";
import {
	MOSAIC_BLOCK,
	mosaicBounds,
	mosaicBrushDiameter,
	mosaicCells,
} from "./mosaic";

/** PRNG determinista (mulberry32): los trazos "aleatorios" son reproducibles. */
function rng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Trazo de ratón: pasos de 1 a 8 px con giros suaves, como un arrastre real. */
function stroke(seed: number, n = 60): Point[] {
	const r = rng(seed);
	let x = 100 + r() * 400;
	let y = 100 + r() * 300;
	let ang = r() * Math.PI * 2;
	const pts: Point[] = [{ x, y }];
	for (let i = 0; i < n; i++) {
		ang += (r() - 0.5) * 0.8;
		const step = 1 + r() * 7;
		x += Math.cos(ang) * step;
		y += Math.sin(ang) * step;
		pts.push({ x, y });
	}
	return pts;
}

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const WIDTHS = STROKE_WIDTHS.map((w) => w.value);

function annotation(points: Point[], stroke_width: number): Annotation {
	return {
		id: "m",
		kind: "mosaic",
		color: "#000000",
		stroke_width,
		start: points[0],
		end: points[points.length - 1],
		points,
	};
}

describe("mosaico pincel — propiedades de la geometría", () => {
	it("hay cuatro grosores y los diámetros del pincel son grosor × 6", () => {
		expect(WIDTHS).toEqual([2, 4, 8, 16]);
		expect(WIDTHS.map(mosaicBrushDiameter)).toEqual([12, 24, 48, 96]);
	});

	it.each(SEEDS)(
		"trazo %i: toda celda está alineada a la rejilla de la imagen y sin repetidos",
		(seed) => {
			for (const w of WIDTHS) {
				const cells = mosaicCells(stroke(seed), mosaicBrushDiameter(w));
				const keys = cells.map((c) => `${c.cx},${c.cy}`);
				expect(new Set(keys).size).toBe(keys.length);
				for (const c of cells) {
					expect(Number.isInteger(c.cx) && Number.isInteger(c.cy)).toBe(true);
				}
			}
		},
	);

	it.each(SEEDS)(
		"trazo %i: nada se pinta lejos del recorrido (fuera del trazo los píxeles no cambian)",
		(seed) => {
			const pts = stroke(seed);
			for (const w of WIDTHS) {
				const d = mosaicBrushDiameter(w);
				const cells = mosaicCells(pts, d);
				for (const c of cells) {
					const cx = (c.cx + 0.5) * MOSAIC_BLOCK;
					const cy = (c.cy + 0.5) * MOSAIC_BLOCK;
					const nearest = Math.min(
						...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)),
					);
					// medio pincel + media diagonal de celda + holgura del adelgazado de puntos
					expect(nearest).toBeLessThanOrEqual(
						d / 2 + MOSAIC_BLOCK * 0.75 + MOSAIC_BLOCK,
					);
				}
			}
		},
	);

	it.each(SEEDS)(
		"trazo %i: cada punto del trazo cae en una celda pintada o pegada a una (sin huecos grandes)",
		(seed) => {
			const pts = stroke(seed);
			const cells = mosaicCells(pts, mosaicBrushDiameter(2));
			for (const p of pts) {
				const px = Math.floor(p.x / MOSAIC_BLOCK);
				const py = Math.floor(p.y / MOSAIC_BLOCK);
				const near = cells.some(
					(c) => Math.abs(c.cx - px) <= 1 && Math.abs(c.cy - py) <= 1,
				);
				expect(near, `punto ${p.x.toFixed(1)},${p.y.toFixed(1)}`).toBe(true);
			}
		},
	);

	it.each(SEEDS)(
		"trazo %i: un pincel más grueso cubre al menos las celdas del más fino",
		(seed) => {
			const pts = stroke(seed);
			let previous = new Set<string>();
			for (const w of WIDTHS) {
				const now = new Set(
					mosaicCells(pts, mosaicBrushDiameter(w)).map(
						(c) => `${c.cx},${c.cy}`,
					),
				);
				for (const k of previous)
					expect(now.has(k), `${w}: falta ${k}`).toBe(true);
				previous = now;
			}
		},
	);

	it.each(SEEDS)(
		"trazo %i: desplazar el trazo un número entero de bloques desplaza las celdas igual",
		(seed) => {
			const pts = stroke(seed);
			const moved = pts.map((p) => ({
				x: p.x + 3 * MOSAIC_BLOCK,
				y: p.y - 2 * MOSAIC_BLOCK,
			}));
			const d = mosaicBrushDiameter(8);
			const a = mosaicCells(pts, d)
				.map((c) => `${c.cx + 3},${c.cy - 2}`)
				.sort();
			const b = mosaicCells(moved, d)
				.map((c) => `${c.cx},${c.cy}`)
				.sort();
			expect(b).toEqual(a);
		},
	);

	it.each(SEEDS)(
		"trazo %i: mosaicBounds envuelve exactamente las celdas",
		(seed) => {
			const cells = mosaicCells(stroke(seed), mosaicBrushDiameter(4));
			const b = mosaicBounds(cells);
			expect(b).not.toBeNull();
			if (!b) return;
			for (const c of cells) {
				expect(c.cx * MOSAIC_BLOCK).toBeGreaterThanOrEqual(b.x);
				expect((c.cx + 1) * MOSAIC_BLOCK).toBeLessThanOrEqual(b.x + b.w);
				expect(c.cy * MOSAIC_BLOCK).toBeGreaterThanOrEqual(b.y);
				expect((c.cy + 1) * MOSAIC_BLOCK).toBeLessThanOrEqual(b.y + b.h);
			}
		},
	);
});

describe("mosaico pincel — consistencia entre lo pintado y lo que Seleccionar/Borrador alcanzan", () => {
	it.each(SEEDS)(
		"trazo %i: el centro de cada celda pintada responde al hitTest",
		(seed) => {
			const pts = stroke(seed);
			for (const w of WIDTHS) {
				const a = annotation(pts, w);
				for (const c of mosaicCells(pts, mosaicBrushDiameter(w))) {
					const centre = {
						x: (c.cx + 0.5) * MOSAIC_BLOCK,
						y: (c.cy + 0.5) * MOSAIC_BLOCK,
					};
					expect(hitTest(a, centre), `grosor ${w}, celda ${c.cx},${c.cy}`).toBe(
						true,
					);
				}
			}
		},
	);

	it.each(SEEDS)(
		"trazo %i: un punto lejos del pincel no responde al hitTest",
		(seed) => {
			const pts = stroke(seed);
			for (const w of WIDTHS) {
				const a = annotation(pts, w);
				const far = { x: -500, y: -500 };
				expect(hitTest(a, far)).toBe(false);
			}
		},
	);
});
