// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import process from "node:process";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useNativeDragGuard } from "./useNativeDragGuard";

// El plugin de Tailwind transforma el CSS, así que ?raw no sirve: se lee del disco.
const css = readFileSync(`${process.cwd()}/src/styles/theme.css`, "utf8");

function Surface({ blockMouseDown }: { blockMouseDown?: boolean }) {
	useNativeDragGuard({ blockMouseDown });
	return (
		<div className="capture-surface" data-testid="root">
			<img alt="foto" src="data:image/png;base64,AA==" />
			<button type="button">botón</button>
			<div data-capture-toolbar>
				<button type="button">toolbar</button>
			</div>
			<textarea aria-label="texto" />
		</div>
	);
}

afterEach(cleanup);

describe("useNativeDragGuard", () => {
	it("cancela dragstart, drag, selectstart y gesturestart sobre la imagen", () => {
		render(<Surface />);
		const img = screen.getByAltText("foto");
		for (const type of ["dragstart", "drag", "selectstart", "gesturestart"]) {
			expect(
				fireEvent(img, new Event(type, { bubbles: true, cancelable: true })),
			).toBe(false);
		}
	});

	it("deja seleccionar y arrastrar texto dentro de un textarea", () => {
		render(<Surface blockMouseDown />);
		const area = screen.getByLabelText("texto");
		expect(
			fireEvent(
				area,
				new Event("selectstart", { bubbles: true, cancelable: true }),
			),
		).toBe(true);
		expect(fireEvent.mouseDown(area)).toBe(true);
	});

	it("con blockMouseDown cancela el mousedown de la superficie, no el de la toolbar", () => {
		render(<Surface blockMouseDown />);
		expect(fireEvent.mouseDown(screen.getByTestId("root"))).toBe(false);
		expect(fireEvent.mouseDown(screen.getByAltText("foto"))).toBe(false);
		expect(fireEvent.mouseDown(screen.getByText("toolbar"))).toBe(true);
	});

	it("sin blockMouseDown (pin, barra de título) el mousedown pasa intacto", () => {
		render(<Surface />);
		expect(fireEvent.mouseDown(screen.getByTestId("root"))).toBe(true);
	});

	it("limpia una selección de texto previa al montar", () => {
		const p = document.createElement("p");
		p.textContent = "texto seleccionado";
		document.body.appendChild(p);
		const range = document.createRange();
		range.selectNodeContents(p);
		window.getSelection()?.addRange(range);
		render(<Surface />);
		expect(window.getSelection()?.rangeCount).toBe(0);
		p.remove();
	});

	it("deja de cancelar al desmontar", () => {
		const { unmount } = render(<Surface blockMouseDown />);
		unmount();
		expect(fireEvent.mouseDown(document.body)).toBe(true);
		expect(
			fireEvent(
				document.body,
				new Event("dragstart", { bubbles: true, cancelable: true }),
			),
		).toBe(true);
	});
});

describe("CSS de .capture-surface", () => {
	it("anula user-select, user-drag y touch-callout en toda la superficie", () => {
		const rule =
			/\.capture-surface,\s*\.capture-surface \* \{([^}]*)\}/.exec(css)?.[1] ??
			"";
		expect(rule).toContain("user-select: none");
		expect(rule).toContain("-webkit-user-select: none");
		expect(rule).toContain("-webkit-user-drag: none");
		expect(rule).toContain("-webkit-touch-callout: none");
	});

	it("solo el textarea de texto recupera user-select", () => {
		expect(css).toMatch(/\.capture-surface textarea \{[^}]*user-select: text/);
	});
});

describe("cursores del overlay en el CSS", () => {
	it("la toolbar y la pista usan cursor normal, lo clicable `pointer` y lo desactivado `not-allowed`", () => {
		expect(css).toMatch(
			/\[data-capture-toolbar\],[\s\S]*?\[data-capture-hint\] \{\s*cursor: default;/,
		);
		expect(css).toMatch(/button:not\(:disabled\),[\s\S]*?cursor: pointer;/);
		expect(css).toMatch(
			/\[data-capture-toolbar\] button:disabled \{\s*cursor: not-allowed;/,
		);
	});
});
