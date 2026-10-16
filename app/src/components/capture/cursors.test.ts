import { describe, expect, it } from "vitest";
import type { AnnotationHandleId } from "./annotations";
import {
	type CursorHit,
	cursorCss,
	cursorFor,
	MAX_CURSOR_SIZE,
	NO_HIT,
	TOOL_CURSORS,
	type ToolCursorId,
} from "./cursors";

const annotation: CursorHit = { kind: "annotation" };
const handle = (h: AnnotationHandleId): CursorHit => ({
	kind: "handle",
	handle: h,
});

describe("cursorFor — herramientas de dibujo con cursor propio", () => {
	it.each([
		"rect",
		"ellipse",
		"arrow",
		"pen",
		"text",
		"mosaic",
		"eraser",
	] as Exclude<ToolCursorId, "endpoint">[])(
		"%s usa su cursor propio con respaldo del sistema, tenga lo que tenga debajo y arrastrando o no",
		(tool) => {
			for (const hit of [NO_HIT, annotation, handle("nw")]) {
				expect(cursorFor(tool, hit, false)).toBe(cursorCss(tool));
				expect(cursorFor(tool, hit, true)).toBe(cursorCss(tool));
			}
			expect(cursorCss(tool)).toMatch(
				new RegExp(`, ${TOOL_CURSORS[tool].fallback}$`),
			);
		},
	);

	it("el cursor propio es un data-URI SVG con hotspot, sin recursos remotos", () => {
		const c = cursorFor("pen", NO_HIT, false);
		expect(c).toContain('url("data:image/svg+xml,');
		expect(c).toContain(" 4 28, crosshair");
		expect(c).not.toMatch(/https?:/);
	});
});

describe("cursorFor — Seleccionar", () => {
	it("en vacío es el normal; arrastrando en vacío sigue siendo el normal", () => {
		expect(cursorFor("select", NO_HIT, false)).toBe("default");
		expect(cursorFor("select", NO_HIT, true)).toBe("default");
	});

	it("sobre una anotación es la manita abierta (`grab`); mientras se arrastra, la cerrada (`grabbing`)", () => {
		expect(cursorFor("select", annotation, false)).toBe("grab");
		expect(cursorFor("select", annotation, true)).toBe("grabbing");
	});

	it("cada esquina tiene su cursor direccional", () => {
		expect(cursorFor("select", handle("nw"), false)).toBe("nwse-resize");
		expect(cursorFor("select", handle("se"), false)).toBe("nwse-resize");
		expect(cursorFor("select", handle("ne"), false)).toBe("nesw-resize");
		expect(cursorFor("select", handle("sw"), false)).toBe("nesw-resize");
	});

	it("las manijas de lado tienen su flecha de redimensión vertical u horizontal", () => {
		expect(cursorFor("select", handle("n"), false)).toBe("ns-resize");
		expect(cursorFor("select", handle("s"), false)).toBe("ns-resize");
		expect(cursorFor("select", handle("e"), false)).toBe("ew-resize");
		expect(cursorFor("select", handle("w"), false)).toBe("ew-resize");
	});

	it("los extremos de una flecha usan un cursor propio (punto libre en 2D)", () => {
		expect(cursorFor("select", handle("start"), false)).toBe(
			cursorCss("endpoint"),
		);
		expect(cursorFor("select", handle("end"), false)).toBe(
			cursorCss("endpoint"),
		);
	});

	it("arrastrar una manija es `grabbing`", () => {
		for (const h of [
			"nw",
			"ne",
			"sw",
			"se",
			"n",
			"e",
			"s",
			"w",
			"start",
			"end",
		] as AnnotationHandleId[]) {
			expect(cursorFor("select", handle(h), true)).toBe("grabbing");
		}
	});
});

describe("cursorFor — sin herramienta", () => {
	it("es el normal", () => {
		expect(cursorFor(null, NO_HIT, false)).toBe("default");
	});
});

const IDS = Object.keys(TOOL_CURSORS) as ToolCursorId[];

describe("juego de cursores propios", () => {
	it("hay uno por herramienta de dibujo, texto y borrador", () => {
		expect(IDS.sort()).toEqual([
			"arrow",
			"ellipse",
			"endpoint",
			"eraser",
			"mosaic",
			"pen",
			"rect",
			"text",
		]);
	});

	it.each(IDS)("%s: tamaño ≤ 32 px y hotspot dentro del cursor", (id) => {
		const d = TOOL_CURSORS[id];
		expect(d.size).toBeLessThanOrEqual(MAX_CURSOR_SIZE);
		const [x, y] = d.hotspot;
		expect(x).toBeGreaterThanOrEqual(0);
		expect(y).toBeGreaterThanOrEqual(0);
		expect(x).toBeLessThan(d.size);
		expect(y).toBeLessThan(d.size);
	});

	it.each(IDS)(
		"%s: el CSS lleva data-URI, hotspot y cursor de sistema de respaldo",
		(id) => {
			const d = TOOL_CURSORS[id];
			const css = cursorCss(id);
			expect(css).toContain('url("data:image/svg+xml,');
			expect(css).toContain(` ${d.hotspot[0]} ${d.hotspot[1]}, ${d.fallback}`);
			expect(["cell", "crosshair", "text", "default"]).toContain(d.fallback);
			expect(css).not.toMatch(/https?:/);
		},
	);

	it.each(IDS)(
		"%s: el SVG es válido a 1x y 2x y usa solo colores con nombre (blanco y negro)",
		(id) => {
			const d = TOOL_CURSORS[id];
			for (const px of [d.size, d.size * 2]) {
				const svg = d.svg(px);
				expect(svg).toContain(`width='${px}'`);
				expect(svg).toContain("viewBox='0 0 32 32'");
				expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
				for (const c of svg.matchAll(/(?:stroke|fill)='([a-z]+)'/g)) {
					expect(["white", "black", "none"]).toContain(c[1]);
				}
			}
		},
	);

	it.each(IDS)("%s: contorno blanco y silueta negra", (id) => {
		const svg = TOOL_CURSORS[id].svg(32);
		expect(svg).toContain("white");
		expect(svg).toContain("black");
	});

	it.each(IDS)(
		"%s: a 1x y a 2x es el mismo dibujo, solo cambia el tamaño (sin copias que se desincronicen)",
		(id) => {
			const d = TOOL_CURSORS[id];
			const normalize = (svg: string, px: number) =>
				svg.split(`'${px}'`).join("'N'");
			expect(normalize(d.svg(d.size), d.size)).toBe(
				normalize(d.svg(d.size * 2), d.size * 2),
			);
		},
	);
});
