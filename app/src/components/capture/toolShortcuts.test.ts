import { describe, expect, it } from "vitest";
import type { Tool } from "./annotationPalette";
import {
	TOOL_BINDINGS,
	toolAriaKeyShortcuts,
	toolForKey,
	toolShortcutLabel,
} from "./toolShortcuts";

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

describe("toolForKey — Alt+letra", () => {
	it.each([
		["KeyH", "select"],
		["KeyR", "rect"],
		["KeyO", "ellipse"],
		["KeyF", "arrow"],
		["KeyL", "pen"],
		["KeyT", "text"],
		["KeyM", "mosaic"],
		["KeyB", "eraser"],
	] as [string, Tool][])("Alt+%s elige %s", (code, tool) => {
		expect(toolForKey(ev(code, { altKey: true }), false)).toBe(tool);
	});

	it("funciona también mientras se escribe un texto", () => {
		expect(toolForKey(ev("KeyF", { altKey: true }), true)).toBe("arrow");
		expect(toolForKey(ev("KeyH", { altKey: true }), true)).toBe("select");
	});

	it("V con Alt no existe: V es solo un alias de la letra sola", () => {
		expect(toolForKey(ev("KeyV", { altKey: true }), false)).toBeNull();
	});

	it("Alt+Shift+letra no hace nada", () => {
		expect(
			toolForKey(ev("KeyF", { altKey: true, shiftKey: true }), false),
		).toBeNull();
	});
});

describe("toolForKey — letra sola", () => {
	it.each([
		["KeyH", "select"],
		["KeyV", "select"],
		["KeyR", "rect"],
		["KeyO", "ellipse"],
		["KeyF", "arrow"],
		["KeyL", "pen"],
		["KeyT", "text"],
		["KeyM", "mosaic"],
		["KeyB", "eraser"],
	] as [string, Tool][])("%s elige %s fuera del texto", (code, tool) => {
		expect(toolForKey(ev(code), false)).toBe(tool);
	});

	it("escribiendo un texto la letra sola no cambia de herramienta", () => {
		for (const b of TOOL_BINDINGS) {
			for (const l of b.plain)
				expect(toolForKey(ev(`Key${l}`), true)).toBeNull();
		}
	});

	it("con Shift (mayúscula) no se interpreta", () => {
		expect(toolForKey(ev("KeyF", { shiftKey: true }), false)).toBeNull();
	});

	it("letras sin herramienta no hacen nada", () => {
		for (const c of ["KeyA", "KeyZ", "KeyQ", "Digit1", "Space", "Enter"]) {
			expect(toolForKey(ev(c), false)).toBeNull();
		}
	});
});

describe("toolForKey — no pisa otros atajos", () => {
	it("Ctrl+C, Ctrl+S, Ctrl+Z, Ctrl+Shift+S y Meta+letra no cambian de herramienta", () => {
		for (const code of [
			"KeyC",
			"KeyS",
			"KeyZ",
			"KeyY",
			"KeyR",
			"KeyF",
			"KeyV",
			"KeyH",
		]) {
			expect(toolForKey(ev(code, { ctrlKey: true }), false)).toBeNull();
			expect(
				toolForKey(ev(code, { ctrlKey: true, shiftKey: true }), false),
			).toBeNull();
			expect(toolForKey(ev(code, { metaKey: true }), false)).toBeNull();
			expect(
				toolForKey(ev(code, { altKey: true, ctrlKey: true }), false),
			).toBeNull();
		}
	});

	it("ninguna letra se repite entre herramientas (ni en Alt ni solas)", () => {
		const alts = TOOL_BINDINGS.map((b) => b.alt);
		const plains = TOOL_BINDINGS.flatMap((b) => b.plain);
		expect(new Set(alts).size).toBe(alts.length);
		expect(new Set(plains).size).toBe(plains.length);
	});

	it("las letras reservadas por otros atajos (C, S, Z, Y) no se usan como herramienta", () => {
		const used = TOOL_BINDINGS.flatMap((b) => [b.alt, ...b.plain]);
		for (const reserved of ["C", "S", "Z", "Y"])
			expect(used).not.toContain(reserved);
	});
});

describe("textos de visibilidad", () => {
	it("etiqueta para tooltips", () => {
		expect(toolShortcutLabel("arrow")).toBe("Alt+F · F");
		expect(toolShortcutLabel("select")).toBe("Alt+H · H · V");
	});

	it("aria-keyshortcuts con alternativas separadas por espacios", () => {
		expect(toolAriaKeyShortcuts("arrow")).toBe("Alt+F F");
		expect(toolAriaKeyShortcuts("select")).toBe("Alt+H H V");
	});

	it("toda herramienta del registro tiene atajo", () => {
		const tools: Tool[] = [
			"select",
			"rect",
			"ellipse",
			"arrow",
			"pen",
			"text",
			"mosaic",
			"eraser",
		];
		for (const t of tools) expect(toolShortcutLabel(t)).not.toBe("");
	});
});
