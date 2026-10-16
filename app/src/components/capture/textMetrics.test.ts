import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTextMeasurer, textWidth, wrapText } from "./textLayout";
import {
	installCanvasTextMetrics,
	measureCanvasText,
	resetTextMetrics,
	textFont,
} from "./textMetrics";

let measureText: ReturnType<typeof vi.fn>;
let font = "";

beforeEach(() => {
	resetTextMetrics();
	measureText = vi.fn((t: string) => ({ width: t.length * 7 }));
	const ctx = {
		measureText,
		get font() {
			return font;
		},
		set font(v: string) {
			font = v;
		},
	};
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
		ctx as unknown as CanvasRenderingContext2D,
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	setTextMeasurer(null);
});

describe("medidor de texto con canvas 2D", () => {
	it("mide con la misma fuente que el pintado y el PNG (peso, tamaño entero, familia)", () => {
		measureCanvasText("unicaprueba", 18);
		expect(font).toBe(textFont(18));
		expect(font).toBe("600 18px Inter, system-ui, sans-serif");
	});

	it("memoiza por (tamaño, texto): medir lo mismo 500 veces llama una sola vez a measureText", () => {
		for (let i = 0; i < 500; i++) measureCanvasText("memoria", 22);
		expect(
			measureText.mock.calls.filter((c) => c[0] === "memoria"),
		).toHaveLength(1);
		measureCanvasText("memoria", 23); // otro tamaño: otra medida
		expect(
			measureText.mock.calls.filter((c) => c[0] === "memoria"),
		).toHaveLength(2);
	});

	it("no usa getBoundingClientRect (no fuerza layout síncrono)", () => {
		const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
		measureCanvasText("sinlayout", 20);
		expect(rect).not.toHaveBeenCalled();
	});

	it("si measureText no devuelve un número, devuelve null y el reparto cae a la estimación", () => {
		measureText.mockReturnValue({ width: undefined });
		expect(measureCanvasText("rara", 31)).toBeNull();
		installCanvasTextMetrics();
		expect(textWidth("rara", 31)).toBeCloseTo(4 * 31 * 0.6, 6);
	});

	it("instalado, textWidth devuelve las medidas reales", () => {
		installCanvasTextMetrics();
		expect(textWidth("instalado", 40)).toBe(9 * 7);
	});
});

describe("rendimiento del reparto al arrastrar el ancho (200 anchos distintos)", () => {
	it("mide cada palabra una sola vez: las llamadas a measureText no crecen con los eventos", () => {
		installCanvasTextMetrics();
		const text =
			"Hola esto es un texto largo que estoy escribiendo sobre una captura de pantalla";
		const words = new Set(text.split(" "));
		for (let i = 0; i < 200; i++) wrapText(text, 18, 120 + i * 3.7);
		// palabras distintas + el espacio (+ algún carácter suelto): independiente de los 200 eventos
		expect(measureText.mock.calls.length).toBeLessThanOrEqual(words.size + 10);
		const after = measureText.mock.calls.length;
		for (let i = 0; i < 200; i++) wrapText(text, 18, 120 + i * 3.7);
		expect(measureText.mock.calls.length).toBe(after);
	});
});
