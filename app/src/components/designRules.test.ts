import { describe, expect, it } from "vitest";

// Regla de diseño (acotada a components/capture/**): ningún componente tiene hex sueltos ni box-shadow.
// Los tokens viven en styles/theme.css; los componentes solo los referencian.

const fuentes = import.meta.glob<string>(
	["./capture/**/*.{ts,tsx}", "./shell/**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
	{ query: "?raw", import: "default", eager: true },
);
const archivos = Object.entries(fuentes).filter(
	([ruta]) => !/\.test\.tsx?$/.test(ruta),
);

describe("reglas de diseño en components/capture/** y components/shell/**", () => {
	it("hay componentes que revisar", () => {
		expect(archivos.length).toBeGreaterThan(0);
	});

	it.each(archivos)("%s no usa colores hex sueltos", (_ruta, src) => {
		const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g);
		expect(hex ?? []).toEqual([]);
	});

	it.each(archivos)("%s no usa box-shadow", (_ruta, src) => {
		expect(src).not.toMatch(
			/box-shadow|boxShadow|\bshadow(-[\w[\]().,/%#-]+)?\b/,
		);
	});
});
