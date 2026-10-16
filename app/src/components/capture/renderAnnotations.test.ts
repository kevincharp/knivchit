import { afterEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "./annotations";
import {
	MOSAIC_BLOCK,
	mosaicBounds,
	mosaicBrushDiameter,
	mosaicCells,
} from "./mosaic";
import {
	composeCapture,
	renderAnnotationsOnly,
	renderSelection,
} from "./renderAnnotations";
import type { Rect } from "./selection";

afterEach(() => {
	vi.restoreAllMocks();
});

/** Stub minimal de CanvasRenderingContext2D: solo lo que este módulo toca. */
function mockCanvasContext() {
	const ctx = {
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		drawImage: vi.fn(),
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		rect: vi.fn(),
		clip: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		closePath: vi.fn(),
		stroke: vi.fn(),
		fill: vi.fn(),
		fillText: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		ellipse: vi.fn(),
		arc: vi.fn(),
		quadraticCurveTo: vi.fn(),
	} as unknown as CanvasRenderingContext2D;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
	return ctx;
}

const selection: Rect = { x: 10, y: 20, w: 50, h: 40 };

function rectAnnotation(): Annotation {
	return {
		id: "a",
		kind: "rect",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 0, y: 0 },
		end: { x: 10, y: 10 },
	};
}

function mosaicAnnotation(): Annotation {
	return {
		id: "m",
		kind: "mosaic",
		color: "#000000",
		stroke_width: 2,
		start: { x: 25, y: 25 },
		end: { x: 65, y: 25 },
		points: [
			{ x: 25, y: 25 },
			{ x: 65, y: 25 },
		],
	};
}

describe("renderAnnotationsOnly — vista previa en vivo, sin recorte de fondo", () => {
	it("nunca dibuja el recorte completo de la pantalla (drawImage) para anotaciones vectoriales", () => {
		const ctx = mockCanvasContext();
		const canvas = document.createElement("canvas");
		renderAnnotationsOnly(canvas, new Image(), selection, [rectAnnotation()]);

		expect(ctx.clearRect).toHaveBeenCalledTimes(1);
		expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	it("sin anotaciones, solo limpia el canvas", () => {
		const ctx = mockCanvasContext();
		const canvas = document.createElement("canvas");
		renderAnnotationsOnly(canvas, new Image(), selection, []);

		expect(ctx.clearRect).toHaveBeenCalledTimes(1);
		expect(ctx.drawImage).not.toHaveBeenCalled();
	});

	it("el pincel de mosaico pixela solo las celdas del trazo, recortado y sin suavizado", () => {
		const ctx = mockCanvasContext();
		const canvas = document.createElement("canvas");
		const a = mosaicAnnotation();
		renderAnnotationsOnly(canvas, new Image(), selection, [a]);

		const cells = mosaicCells(
			a.points ?? [],
			mosaicBrushDiameter(a.stroke_width),
		);
		const b = mosaicBounds(cells);
		expect(b).not.toBeNull();
		// Una celda recortada por rect(), exactamente las del trazo y nada más.
		const rects = vi.mocked(ctx.rect).mock.calls;
		expect(rects).toHaveLength(cells.length);
		expect(
			rects.map((r) => `${r[0] / MOSAIC_BLOCK},${r[1] / MOSAIC_BLOCK}`).sort(),
		).toEqual(cells.map((c) => `${c.cx},${c.cy}`).sort());
		for (const r of rects) {
			expect(r[2]).toBe(MOSAIC_BLOCK);
			expect(r[3]).toBe(MOSAIC_BLOCK);
		}
		expect(ctx.clip).toHaveBeenCalledTimes(1);
		expect(ctx.imageSmoothingEnabled).toBe(false);

		// Dos dibujados: muestreo de la imagen (reduce a una celda por píxel) y reescalado.
		const draws = vi.mocked(ctx.drawImage).mock.calls;
		expect(draws).toHaveLength(2);
		const [, sx, sy, sw, sh, dx0, dy0, dw0, dh0] = draws[0] as unknown[];
		expect([sx, sy, sw, sh, dx0, dy0, dw0, dh0]).toEqual([
			b?.x,
			b?.y,
			b?.w,
			b?.h,
			0,
			0,
			b?.cols,
			b?.rows,
		]);
		const [, ax, ay, aw, ah, bx, by, bw, bh] = draws[1] as unknown[];
		expect([ax, ay, aw, ah, bx, by, bw, bh]).toEqual([
			0,
			0,
			b?.cols,
			b?.rows,
			b?.x,
			b?.y,
			b?.w,
			b?.h,
		]);
	});

	it("el recorte se fija antes del reescalado y no se dibuja ningún relleno ni contorno", () => {
		const ctx = mockCanvasContext();
		renderAnnotationsOnly(
			document.createElement("canvas"),
			new Image(),
			selection,
			[mosaicAnnotation()],
		);
		const clipAt = vi.mocked(ctx.clip).mock.invocationCallOrder[0];
		const scaleUpAt = vi.mocked(ctx.drawImage).mock.invocationCallOrder[1];
		expect(clipAt).toBeLessThan(scaleUpAt);
		expect(ctx.fillRect).not.toHaveBeenCalled();
		expect(ctx.strokeRect).not.toHaveBeenCalled();
		expect(ctx.stroke).not.toHaveBeenCalled();
	});

	it("un trazo más grueso cubre más celdas", () => {
		const ctx = mockCanvasContext();
		const fino = mosaicAnnotation();
		const grueso = { ...fino, stroke_width: 8 };
		renderAnnotationsOnly(
			document.createElement("canvas"),
			new Image(),
			selection,
			[fino],
		);
		const pocas = vi.mocked(ctx.rect).mock.calls.length;
		vi.mocked(ctx.rect).mockClear();
		renderAnnotationsOnly(
			document.createElement("canvas"),
			new Image(),
			selection,
			[grueso],
		);
		expect(vi.mocked(ctx.rect).mock.calls.length).toBeGreaterThan(pocas);
	});

	it("el mosaico se mueve con el origen de la selección (celdas en píxeles de la imagen)", () => {
		const ctx = mockCanvasContext();
		renderAnnotationsOnly(
			document.createElement("canvas"),
			new Image(),
			selection,
			[mosaicAnnotation()],
		);
		expect(ctx.translate).toHaveBeenCalledWith(-selection.x, -selection.y);
	});

	it("ajusta el tamaño del canvas a la selección", () => {
		mockCanvasContext();
		const canvas = document.createElement("canvas");
		renderAnnotationsOnly(canvas, new Image(), selection, []);

		expect(canvas.width).toBe(selection.w);
		expect(canvas.height).toBe(selection.h);
	});
});

describe("texto — pantalla y PNG final pintan el mismo reparto en líneas", () => {
	const text: Annotation = {
		id: "t",
		kind: "text",
		color: "#ffffff",
		stroke_width: 4,
		start: { x: 30, y: 40 },
		end: { x: 30, y: 40 },
		text: "hola mundo",
		font_size: 20,
		box_width: 70,
	};
	// 20 px → 12 px por carácter; 70 px caben 5 caracteres: «hola» / «mundo»

	it("pinta cada línea repartida en coordenadas de imagen, con el tamaño de fuente propio", () => {
		for (const draw of [renderAnnotationsOnly, renderSelection]) {
			const ctx = mockCanvasContext();
			const canvas = document.createElement("canvas");
			draw(canvas, new Image(), selection, [text]);
			const calls = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock
				.calls;
			expect(calls).toEqual([
				["hola", 30, 40],
				["mundo", 30, 40 + 20 * 1.2],
			]);
			expect(ctx.font).toContain("20px");
			vi.restoreAllMocks();
		}
	});

	it("sin box_width ni font_size mantiene el comportamiento anterior (fuente = 6 × grosor, una línea por salto)", () => {
		const ctx = mockCanvasContext();
		const plain: Annotation = {
			...text,
			font_size: undefined,
			box_width: undefined,
			text: "a\nb",
		};
		renderAnnotationsOnly(
			document.createElement("canvas"),
			new Image(),
			selection,
			[plain],
		);
		const calls = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(calls).toEqual([
			["a", 30, 40],
			["b", 30, 40 + 24 * 1.2],
		]);
		expect(ctx.font).toContain("24px");
	});
});

describe("renderSelection — composición final, único lugar que duplica la pantalla", () => {
	it("dibuja el recorte completo una vez y las anotaciones encima", () => {
		const ctx = mockCanvasContext();
		const canvas = document.createElement("canvas");
		renderSelection(canvas, new Image(), selection, [rectAnnotation()]);

		expect(ctx.drawImage).toHaveBeenCalledTimes(1);
		expect(ctx.drawImage).toHaveBeenCalledWith(
			expect.anything(),
			selection.x,
			selection.y,
			selection.w,
			selection.h,
			0,
			0,
			selection.w,
			selection.h,
		);
		expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
	});
});

describe("composeCapture — usa un canvas nunca insertado en el DOM", () => {
	it("el canvas que compone el PNG no se agrega al árbol del documento", async () => {
		mockCanvasContext();
		const toBlobSpy = vi
			.spyOn(HTMLCanvasElement.prototype, "toBlob")
			.mockImplementation(function (this: HTMLCanvasElement, cb) {
				cb?.(new Blob([new Uint8Array([1, 2, 3])]));
			});
		const bodyChildrenBefore = document.body.childElementCount;

		await composeCapture(new Image(), selection, [rectAnnotation()]);

		expect(document.body.childElementCount).toBe(bodyChildrenBefore);
		toBlobSpy.mockRestore();
	});
});
