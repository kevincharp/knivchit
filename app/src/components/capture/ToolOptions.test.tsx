import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tool } from "./annotationPalette";
import { ToolOptions } from "./ToolOptions";

afterEach(cleanup);

function setup(tool: Tool | null, color = "red", strokeWidth = 4) {
	const onColorChange = vi.fn();
	const onStrokeWidthChange = vi.fn();
	const view = render(
		<ToolOptions
			tool={tool}
			color={color}
			onColorChange={onColorChange}
			strokeWidth={strokeWidth}
			onStrokeWidthChange={onStrokeWidthChange}
		/>,
	);
	return { view, onColorChange, onStrokeWidthChange };
}

describe("ToolOptions", () => {
	it.each([null, "eraser"] as const)("sin opciones para %s", (tool) => {
		const { view } = setup(tool);
		expect(view.container).toBeEmptyDOMElement();
	});

	it("el mosaico muestra grosor pero no color", () => {
		setup("mosaic");
		expect(screen.queryByRole("radiogroup", { name: "Color" })).toBeNull();
		expect(screen.getByRole("radiogroup", { name: "Grosor" })).toBeVisible();
	});

	it.each(["rect", "ellipse", "arrow", "pen"] as const)(
		"%s muestra color y grosor",
		(tool) => {
			setup(tool);
			expect(screen.getByRole("radiogroup", { name: "Color" })).toBeVisible();
			expect(screen.getByRole("radiogroup", { name: "Grosor" })).toBeVisible();
		},
	);

	it("el texto muestra color y TAMAÑO DE FUENTE (no grosor), con el valor en px a la vista", () => {
		setup("text", "red", 4);
		expect(screen.getByRole("radiogroup", { name: "Color" })).toBeVisible();
		expect(screen.queryByRole("radiogroup", { name: "Grosor" })).toBeNull();
		expect(
			screen.getByRole("radiogroup", { name: "Tamaño del texto" }),
		).toBeVisible();
		// Sin tamaño explícito se deriva del grosor: 4 × 6 = 24 px
		expect(screen.getByRole("radio", { name: "Texto mediano" })).toBeChecked();
		expect(screen.getByLabelText("Tamaño de fuente actual")).toHaveTextContent(
			"24 px",
		);
	});

	it("con un tamaño explícito marca el preset igual y, si no coincide con ninguno, ninguno", () => {
		const onFontSizeChange = vi.fn();
		const { rerender } = render(
			<ToolOptions
				tool="text"
				color="red"
				onColorChange={vi.fn()}
				strokeWidth={4}
				onStrokeWidthChange={vi.fn()}
				fontSize={48}
				onFontSizeChange={onFontSizeChange}
			/>,
		);
		expect(screen.getByRole("radio", { name: "Texto grande" })).toBeChecked();
		rerender(
			<ToolOptions
				tool="text"
				color="red"
				onColorChange={vi.fn()}
				strokeWidth={4}
				onStrokeWidthChange={vi.fn()}
				fontSize={37.4}
				onFontSizeChange={onFontSizeChange}
			/>,
		);
		for (const r of screen
			.getByRole("radiogroup", { name: "Tamaño del texto" })
			.querySelectorAll("[role=radio]")) {
			expect(r).not.toBeChecked();
		}
		expect(screen.getByLabelText("Tamaño de fuente actual")).toHaveTextContent(
			"37 px",
		);
		fireEvent.click(screen.getByRole("radio", { name: "Texto pequeño" }));
		expect(onFontSizeChange).toHaveBeenCalledWith(12);
	});

	it("ofrece los seis colores y los tres grosores con nombre accesible", () => {
		setup("rect");
		const colores = screen
			.getByRole("radiogroup", { name: "Color" })
			.querySelectorAll("[role=radio]");
		expect([...colores].map((c) => c.getAttribute("aria-label"))).toEqual([
			"Rojo",
			"Ámbar",
			"Azul",
			"Verde",
			"Blanco",
			"Negro",
		]);
		for (const n of ["Fino", "Medio", "Grueso"]) {
			expect(screen.getByRole("radio", { name: n })).toBeInTheDocument();
		}
	});

	it("marca con aria-checked solo el color y el grosor elegidos", () => {
		setup("rect", "blue", 8);
		expect(screen.getByRole("radio", { name: "Azul" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "Rojo" })).not.toBeChecked();
		expect(screen.getByRole("radio", { name: "Grueso" })).toBeChecked();
		expect(screen.getByRole("radio", { name: "Fino" })).not.toBeChecked();
	});

	it("elegir color o grosor llama al callback con el id/valor", () => {
		const { onColorChange, onStrokeWidthChange } = setup("pen");
		fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
		fireEvent.click(screen.getByRole("radio", { name: "Fino" }));
		expect(onColorChange).toHaveBeenCalledWith("green");
		expect(onStrokeWidthChange).toHaveBeenCalledWith(2);
	});
});

describe("ToolOptions — alineación del texto", () => {
	function withAlign(align?: "left" | "center" | "right") {
		const onTextAlignChange = vi.fn();
		render(
			<ToolOptions
				tool="text"
				color="red"
				onColorChange={vi.fn()}
				strokeWidth={4}
				onStrokeWidthChange={vi.fn()}
				textAlign={align}
				onTextAlignChange={onTextAlignChange}
			/>,
		);
		return onTextAlignChange;
	}

	it("tres botones con aria-label y aria-pressed; sin valor, izquierda", () => {
		withAlign();
		expect(
			screen.getByRole("button", { name: "Alinear a la izquierda" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(
			screen.getByRole("button", { name: "Alinear al centro" }),
		).toHaveAttribute("aria-pressed", "false");
		expect(
			screen.getByRole("button", { name: "Alinear a la derecha" }),
		).toHaveAttribute("aria-pressed", "false");
	});

	it("marca solo la elegida y llama al callback con su id", () => {
		const onChange = withAlign("center");
		expect(
			screen.getByRole("button", { name: "Alinear al centro" }),
		).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(
			screen.getByRole("button", { name: "Alinear a la derecha" }),
		);
		expect(onChange).toHaveBeenCalledWith("right");
	});

	it("otras herramientas no muestran la alineación", () => {
		setup("rect");
		expect(screen.queryByRole("button", { name: /Alinear/ })).toBeNull();
	});
});
