import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ICON_VIEWBOX, TOOL_ICONS } from "./toolbarIcons";

function icon(name: keyof typeof TOOL_ICONS) {
	const { container } = render(
		<svg viewBox={ICON_VIEWBOX} aria-hidden="true">
			{TOOL_ICONS[name]}
		</svg>,
	);
	return container;
}

describe("glifos de la toolbar", () => {
	it("usan una rejilla cuadrada", () => {
		const [, , w, h] = ICON_VIEWBOX.split(" ").map(Number);
		expect(w).toBe(h);
	});

	it("el glifo de rectángulo es un cuadrado perfecto", () => {
		const rect = icon("rect").querySelector("rect");
		expect(rect).not.toBeNull();
		expect(rect?.getAttribute("width")).toBe(rect?.getAttribute("height"));
	});

	it("el glifo de elipse es un círculo perfecto", () => {
		const c = icon("ellipse");
		const circle = c.querySelector("circle");
		const ellipse = c.querySelector("ellipse");
		if (ellipse) {
			expect(ellipse.getAttribute("rx")).toBe(ellipse.getAttribute("ry"));
		} else {
			expect(circle).not.toBeNull();
		}
	});

	it("rectángulo y círculo ocupan la misma caja (mismo tamaño óptico)", () => {
		const rect = icon("rect").querySelector("rect");
		const circle = icon("ellipse").querySelector("circle");
		expect(Number(circle?.getAttribute("r")) * 2).toBe(
			Number(rect?.getAttribute("width")),
		);
	});

	it("el texto es una T dentro de un recuadro redondeado", () => {
		const c = icon("text");
		expect(c.querySelector("rect")?.getAttribute("rx")).not.toBeNull();
		expect(c.querySelector("path")).not.toBeNull();
	});
});
