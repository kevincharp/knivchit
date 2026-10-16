import { describe, expect, it } from "vitest";
import {
	MOSAIC_BLOCK,
	MOSAIC_BRUSH_PER_STROKE,
	mosaicBounds,
	mosaicBrushDiameter,
	mosaicCells,
} from "./mosaic";

const key = (c: { cx: number; cy: number }) => `${c.cx},${c.cy}`;

describe("mosaicBrushDiameter", () => {
	it("escala con el grosor elegido", () => {
		expect(mosaicBrushDiameter(2)).toBe(2 * MOSAIC_BRUSH_PER_STROKE);
		expect(mosaicBrushDiameter(8)).toBe(8 * MOSAIC_BRUSH_PER_STROKE);
	});
});

describe("mosaicCells", () => {
	it("sin puntos o sin pincel no hay celdas", () => {
		expect(mosaicCells([], 24)).toEqual([]);
		expect(mosaicCells([{ x: 5, y: 5 }], 0)).toEqual([]);
	});

	it("un toque sin mover cubre al menos la celda del punto, aunque el pincel sea chico", () => {
		const cells = mosaicCells([{ x: 14, y: 26 }], 2);
		expect(cells.map(key)).toContain("1,2");
	});

	it("una cruz de pincel grande cubre un disco de celdas alrededor del punto", () => {
		const B = MOSAIC_BLOCK;
		const cells = mosaicCells([{ x: 50, y: 50 }], 4 * B);
		const keys = new Set(cells.map(key));
		// El centro y los vecinos inmediatos están; las esquinas lejanas, no.
		expect(keys.has("5,5")).toBe(true);
		expect(keys.has("4,5")).toBe(true);
		expect(keys.has("6,5")).toBe(true);
		expect(keys.has("5,3")).toBe(true);
		expect(keys.has("0,0")).toBe(false);
		expect(keys.has("9,9")).toBe(false);
	});

	it("un trazo recto cubre una franja: lo de dentro está, lo de lejos no", () => {
		const B = MOSAIC_BLOCK;
		const stroke = [
			{ x: 5, y: 55 },
			{ x: 205, y: 55 },
		];
		const keys = new Set(mosaicCells(stroke, 2 * B).map(key));
		for (let cx = 0; cx <= 20; cx++) expect(keys.has(`${cx},5`)).toBe(true);
		// A una fila de distancia del eje queda dentro del pincel (radio = 1 bloque)…
		expect(keys.has("10,4")).toBe(true);
		// …a tres, no.
		expect(keys.has("10,2")).toBe(false);
		expect(keys.has("10,8")).toBe(false);
		// Antes del inicio y después del final no hay nada.
		expect(keys.has("-3,5")).toBe(false);
		expect(keys.has("25,5")).toBe(false);
	});

	it("sigue las curvas: una L no rellena el hueco de la esquina", () => {
		const B = MOSAIC_BLOCK;
		const L = [
			{ x: 5, y: 5 },
			{ x: 5, y: 105 },
			{ x: 105, y: 105 },
		];
		const keys = new Set(mosaicCells(L, B).map(key));
		expect(keys.has("0,5")).toBe(true);
		expect(keys.has("5,10")).toBe(true);
		expect(keys.has("5,5")).toBe(false);
	});

	it("es determinista y está ordenado por fila y columna, sin repetidos", () => {
		const pts = [
			{ x: 33, y: 41 },
			{ x: 80, y: 60 },
			{ x: 20, y: 90 },
		];
		const a = mosaicCells(pts, 30);
		const b = mosaicCells(pts, 30);
		expect(a).toEqual(b);
		expect(new Set(a.map(key)).size).toBe(a.length);
		const sorted = [...a].sort((p, q) => p.cy - q.cy || p.cx - q.cx);
		expect(a).toEqual(sorted);
	});

	it("puntos casi repetidos no cambian el resultado de un trazo equivalente", () => {
		const dense: { x: number; y: number }[] = [];
		for (let x = 0; x <= 100; x++) dense.push({ x, y: 40 });
		const sparse = [
			{ x: 0, y: 40 },
			{ x: 100, y: 40 },
		];
		expect(mosaicCells(dense, 20).map(key)).toEqual(
			mosaicCells(sparse, 20).map(key),
		);
	});

	it("la rejilla parte del (0,0) de la imagen: mover el trazo un bloque desplaza las celdas un bloque", () => {
		const B = MOSAIC_BLOCK;
		const base = mosaicCells(
			[
				{ x: 33, y: 41 },
				{ x: 80, y: 60 },
			],
			30,
		);
		const moved = mosaicCells(
			[
				{ x: 33 + B, y: 41 + 2 * B },
				{ x: 80 + B, y: 60 + 2 * B },
			],
			30,
		);
		expect(moved.map(key)).toEqual(
			base
				.map((c) => `${c.cx + 1},${c.cy + 2}`)
				.sort((a, b) => {
					const [ax, ay] = a.split(",").map(Number);
					const [bx, by] = b.split(",").map(Number);
					return ay - by || ax - bx;
				}),
		);
	});
});

describe("mosaicBounds", () => {
	it("sin celdas es null", () => {
		expect(mosaicBounds([])).toBeNull();
	});

	it("envuelve las celdas en píxeles de imagen", () => {
		const B = MOSAIC_BLOCK;
		const b = mosaicBounds([
			{ cx: 2, cy: 3 },
			{ cx: 4, cy: 3 },
			{ cx: 3, cy: 6 },
		]);
		expect(b).toEqual({
			x: 2 * B,
			y: 3 * B,
			w: 3 * B,
			h: 4 * B,
			cols: 3,
			rows: 4,
		});
	});
});
