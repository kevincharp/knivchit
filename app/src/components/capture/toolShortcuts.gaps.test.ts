import { describe, expect, it } from "vitest";
import type { Tool } from "./annotationPalette";
import { cursorCss, cursorFor, NO_HIT } from "./cursors";
import { TOOL_BINDINGS, toolForKey } from "./toolShortcuts";

const ev = (
	code: string,
	over: Partial<Parameters<typeof toolForKey>[0]> = {},
) => ({
	code,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	...over,
});

describe("toolForKey — huecos", () => {
	it("Alt+Meta y Alt+Ctrl no eligen herramienta", () => {
		expect(
			toolForKey(ev("KeyR", { altKey: true, metaKey: true }), false),
		).toBeNull();
		expect(
			toolForKey(ev("KeyR", { altKey: true, ctrlKey: true }), false),
		).toBeNull();
	});

	it("solo reconoce teclas de letra físicas: dígitos, F, numpad y códigos raros no", () => {
		for (const code of [
			"Digit1",
			"F1",
			"Numpad1",
			"Space",
			"Escape",
			"KeyÑ",
			"Key",
			"keyr",
			"KeyRR",
			"",
		]) {
			expect(toolForKey(ev(code), false), code).toBeNull();
			expect(toolForKey(ev(code, { altKey: true }), false), code).toBeNull();
		}
	});

	it("la letra sola y la Alt+letra coinciden en herramienta, salvo el alias V de Seleccionar", () => {
		for (const b of TOOL_BINDINGS) {
			expect(toolForKey(ev(`Key${b.alt}`, { altKey: true }), false)).toBe(
				b.tool,
			);
			for (const p of b.plain) {
				expect(toolForKey(ev(`Key${p}`), false)).toBe(b.tool);
			}
		}
	});

	it("editando texto, Alt+letra sigue valiendo para todas las herramientas", () => {
		for (const b of TOOL_BINDINGS) {
			expect(toolForKey(ev(`Key${b.alt}`, { altKey: true }), true)).toBe(
				b.tool,
			);
		}
	});

	it("es independiente de la distribución: usa `code`, nunca `key`", () => {
		const layoutDvorak = { ...ev("KeyR"), key: "p" };
		expect(toolForKey(layoutDvorak, false)).toBe("rect");
	});
});

describe("cursorFor — huecos", () => {
	const TOOLS: (Tool | null)[] = ["rect", "ellipse", "arrow", "pen", "mosaic"];

	it("las herramientas de dibujo ignoran lo que hay debajo y si se arrastra: siempre su cursor propio", () => {
		for (const t of TOOLS.filter(Boolean)) {
			for (const hit of [
				NO_HIT,
				{ kind: "annotation" as const },
				{ kind: "handle" as const, handle: "se" as const },
			]) {
				for (const dragging of [false, true]) {
					expect(
						cursorFor(t, hit, dragging),
						`${t}/${hit.kind}/${dragging}`,
					).toBe(cursorCss(t as "rect"));
				}
			}
		}
	});

	it("sin herramienta, texto y borrador no cambian con el hit ni con el arrastre", () => {
		for (const hit of [
			NO_HIT,
			{ kind: "annotation" as const },
			{ kind: "handle" as const, handle: "nw" as const },
		]) {
			expect(cursorFor(null, hit, true)).toBe("default");
			expect(cursorFor("text", hit, true)).toBe(cursorCss("text"));
			expect(cursorFor("eraser", hit, false)).toBe(
				cursorFor("eraser", NO_HIT, true),
			);
		}
	});

	it("Seleccionar: sin nada debajo es el normal también mientras se arrastra", () => {
		expect(cursorFor("select", NO_HIT, true)).toBe("default");
	});
});
