// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import process from "node:process";
import { describe, expect, it } from "vitest";

/**
 * El script en línea de index.html corre antes del primer pintado. Sin él, el
 * webview del overlay (y el del pin) se muestra sobre el BLANCO por defecto
 * hasta que React monta: un destello al iniciar la captura. Aquí se ejecuta ese
 * script con un `location`, un `localStorage` y un `document` de mentira.
 */
const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

function run(search: string, stored: Record<string, string> = {}, dark = true) {
	const root = {
		style: {} as Record<string, string>,
		attrs: {} as Record<string, string>,
		setAttribute(k: string, v: string) {
			this.attrs[k] = v;
		},
	};
	new Function("location", "localStorage", "matchMedia", "document", script)(
		{ search },
		{ getItem: (k: string) => stored[k] ?? null },
		() => ({ matches: dark }),
		{ documentElement: root },
	);
	return root;
}

describe("index.html — primer frame de cada ventana", () => {
	it("hay un script en línea que corre antes del cuerpo", () => {
		expect(script).toContain("documentElement");
		expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<body"));
	});

	it.each(["capture-overlay", "pin"])(
		"%s: fondo oscuro neutro fijo desde el HTML estático, sin tema",
		(kind) => {
			const root = run(`?window=${kind}`);
			expect(root.style.background).toBe("#05070d");
			expect(root.style.colorScheme).toBe("dark");
			expect(root.attrs["data-theme"]).toBeUndefined();
		},
	);

	it("el overlay ignora el tema guardado: con «claro» en localStorage sigue oscuro", () => {
		const root = run(
			"?window=capture-overlay",
			{ "knivchit-theme": "light" },
			false,
		);
		expect(root.style.background).toBe("#05070d");
		expect(root.attrs["data-theme"]).toBeUndefined();
	});

	it("la ventana principal sigue usando el tema guardado", () => {
		expect(run("", { "knivchit-theme": "light" }).attrs["data-theme"]).toBe(
			"light",
		);
		expect(
			run("", { "knivchit-theme": "dark" }, false).attrs["data-theme"],
		).toBe("dark");
		expect(run("", {}, true).attrs["data-theme"]).toBe("dark");
		expect(run("", {}, false).attrs["data-theme"]).toBe("light");
		expect(run("").style.background).toBeUndefined();
	});

	it("el color fijo es el de --color-chrome del tema oscuro", () => {
		const css = readFileSync(`${process.cwd()}/src/styles/theme.css`, "utf8");
		expect(css).toMatch(/--color-chrome:\s*#05070d/i);
	});
});
