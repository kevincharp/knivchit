import { afterEach, describe, expect, it, vi } from "vitest";
import type { Annotation } from "./annotations";
import { renderAnnotationsOnly, renderSelection } from "./renderAnnotations";
import type { Rect } from "./selection";

/**
 * Alineación del texto (`text_align`: 'left' | 'center' | 'right', por defecto
 * 'left'), la misma en pantalla (`renderAnnotationsOnly`) y en el PNG final
 * (`renderSelection`). Se mide el borde izquierdo EFECTIVO de cada línea, sea
 * cual sea la técnica (mover `x` o fijar `ctx.textAlign`), con un `measureText`
 * simulado a 0,5 em por carácter.
 *
 * Fija el contrato de `text_align` (izquierda, centro, derecha) respecto al recuadro.
 */
const alineacion = it;

afterEach(() => {
	vi.restoreAllMocks();
});

const SELECTION: Rect = { x: 0, y: 0, w: 600, h: 400 };
const SIZE = 20;
const BOX = 300;
const widthOf = (t: string) => t.length * SIZE * 0.5;

interface Pintado {
	text: string;
	x: number;
	y: number;
	align: string;
}

/** Contexto que recuerda el `textAlign` vigente en cada `fillText`. */
function pintar(
	draw: typeof renderAnnotationsOnly | typeof renderSelection,
	a: Annotation,
): Pintado[] {
	const out: Pintado[] = [];
	const state: Record<string, unknown> = { textAlign: "left" };
	const ctx = new Proxy(state, {
		get: (t, k: string) => {
			if (k === "fillText") {
				return (text: string, x: number, y: number) =>
					out.push({ text, x, y, align: String(t.textAlign) });
			}
			if (k === "measureText") {
				return (text: string) => ({ width: widthOf(text) });
			}
			if (!(k in t)) t[k] = vi.fn();
			return t[k];
		},
		set: (t, k: string, v) => {
			t[k] = v;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
	draw(document.createElement("canvas"), new Image(), SELECTION, [a]);
	vi.restoreAllMocks();
	return out;
}

const texto = (align?: "left" | "center" | "right"): Annotation =>
	({
		id: "t",
		kind: "text",
		color: "#ffffff",
		stroke_width: 4,
		start: { x: 100, y: 50 },
		end: { x: 100, y: 50 },
		text: "uno\ndos tres cuatro\ncinco",
		font_size: SIZE,
		box_width: BOX,
		...(align ? { text_align: align } : {}),
	}) as Annotation;

/** Borde izquierdo efectivo de una línea según el `textAlign` con el que se pintó. */
const izquierdo = (p: Pintado) =>
	p.align === "center"
		? p.x - widthOf(p.text) / 2
		: p.align === "right" || p.align === "end"
			? p.x - widthOf(p.text)
			: p.x;

describe("alineación del texto: pantalla y PNG pintan igual", () => {
	for (const [nombre, draw] of [
		["pantalla", renderAnnotationsOnly],
		["PNG", renderSelection],
	] as const) {
		alineacion.each([
			["left", (w: number) => 0 * w],
			["center", (w: number) => (BOX - w) / 2],
			["right", (w: number) => BOX - w],
		] as const)(
			`${nombre}: %s alinea cada línea respecto al recuadro, no a la selección`,
			(align, desplazamiento) => {
				const lines = pintar(draw, texto(align));
				expect(lines.map((l) => l.text)).toEqual([
					"uno",
					"dos tres cuatro",
					"cinco",
				]);
				for (const l of lines) {
					expect(izquierdo(l), `«${l.text}»`).toBeCloseTo(
						100 + desplazamiento(widthOf(l.text)),
						5,
					);
				}
			},
		);

		alineacion(
			`${nombre}: sin text_align se comporta como la izquierda`,
			() => {
				const sin = pintar(draw, texto()).map(izquierdo);
				const izq = pintar(draw, texto("left")).map(izquierdo);
				expect(sin).toEqual(izq);
			},
		);
	}

	alineacion("pantalla y PNG dan las mismas posiciones efectivas", () => {
		for (const a of ["left", "center", "right"] as const) {
			const p = pintar(renderAnnotationsOnly, texto(a)).map(izquierdo);
			const q = pintar(renderSelection, texto(a)).map(izquierdo);
			expect(q).toEqual(p);
		}
	});
});
