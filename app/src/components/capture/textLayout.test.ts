import { afterEach, describe, expect, it, vi } from "vitest";
import { setTextMeasurer, textWidth, wrapText } from "./textLayout";

afterEach(() => setTextMeasurer(null));

/** Medidor de mentira con anchos desiguales: «i» y espacio finos, «W» ancha, el resto 10. */
const fake = (text: string, size: number) =>
	[...text].reduce(
		(sum, ch) =>
			sum + ((ch === "i" || ch === " " ? 4 : ch === "W" ? 20 : 10) * size) / 10,
		0,
	);

describe("wrapText con medidas reales", () => {
	it("sin medidor estima 0,6 em por carácter", () => {
		expect(textWidth("abcd", 10)).toBeCloseTo(24, 6);
	});

	it("con medidor usa los anchos reales y aprovecha el borde derecho", () => {
		// Con la estimación (6 px/car. a 10 px) «ii ii ii ii» ocuparía 11·6 = 66; real: 8 «i» (4) + 3 espacios (4) = 44
		const text = "ii ii ii ii";
		expect(wrapText(text, 10, 50)).toHaveLength(2); // estimado: no cabe
		setTextMeasurer(fake);
		expect(wrapText(text, 10, 50)).toEqual([text]); // real: cabe en 44 ≤ 50
	});

	it("ninguna línea medida pasa de box_width", () => {
		setTextMeasurer(fake);
		const text =
			"Hola esto es un texto largo que estoy escribiendo sobre una captura WWW de pantalla";
		for (const max of [40, 75, 120, 333]) {
			for (const line of wrapText(text, 18, max)) {
				// palabra a palabra más espacios, como reparte el algoritmo
				expect(textWidth(line, 18)).toBeLessThanOrEqual(max + 1e-9);
			}
		}
	});

	it("una palabra más ancha que la caja se parte por caracteres sin rebasarla", () => {
		setTextMeasurer(fake);
		const lines = wrapText("abcdefghijklmnopqrstuvwxyz", 10, 55);
		expect(lines.length).toBeGreaterThan(3);
		expect(lines.join("")).toBe("abcdefghijklmnopqrstuvwxyz");
		for (const l of lines) expect(textWidth(l, 10)).toBeLessThanOrEqual(55);
	});

	it("una caja más estrecha que un carácter pone uno por línea (nunca se queda en bucle)", () => {
		setTextMeasurer(fake);
		expect(wrapText("abc", 10, 3)).toEqual(["a", "b", "c"]);
	});

	it("respeta los saltos propios y los párrafos vacíos", () => {
		setTextMeasurer(fake);
		expect(wrapText("a\n\nb", 10, 100)).toEqual(["a", "", "b"]);
		expect(wrapText("a\nb", 10)).toEqual(["a", "b"]);
	});

	it("memoiza: repetir el mismo reparto (arrastre) no vuelve a medir", () => {
		const spy = vi.fn(fake);
		setTextMeasurer(spy);
		const text = "una frase de prueba para repartir en líneas";
		wrapText(text, 18, 150);
		const first = spy.mock.calls.length;
		expect(first).toBeGreaterThan(0);
		for (let i = 0; i < 200; i++) wrapText(text, 18, 150);
		expect(spy.mock.calls.length).toBe(first);
	});

	it("cambiar de medidor descarta los repartos guardados", () => {
		const text = "ii ii ii ii";
		expect(wrapText(text, 10, 50)).toHaveLength(2);
		setTextMeasurer(fake);
		expect(wrapText(text, 10, 50)).toHaveLength(1);
	});
});
