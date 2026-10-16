import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureToolbar } from "./CaptureToolbar";

afterEach(cleanup);

function setup(
	over: Partial<React.ComponentProps<typeof CaptureToolbar>> = {},
) {
	const props = {
		tool: null,
		onToolChange: vi.fn(),
		canUndo: true,
		canRedo: true,
		onUndo: vi.fn(),
		onRedo: vi.fn(),
		onPin: vi.fn(),
		onSave: vi.fn(),
		onSaveAs: vi.fn(),
		onCancel: vi.fn(),
		onConfirm: vi.fn(),
		...over,
	};
	render(<CaptureToolbar {...props} />);
	return props;
}

// Spec §11: etiquetas y orden de la toolbar.
const ORDEN = [
	"Seleccionar",
	"Rectángulo",
	"Elipse",
	"Flecha",
	"Lápiz",
	"Texto",
	"Mosaico",
	"Borrador",
	"Deshacer",
	"Rehacer",
	"Extraer texto (OCR)",
	"Traducir",
	"Leer código QR",
	"Fijar en pantalla",
	"Guardar",
	"Guardar como…",
	"Cancelar",
	"Copiar y cerrar",
];
const PROXIMAMENTE = ["Extraer texto (OCR)", "Traducir", "Leer código QR"];

describe("CaptureToolbar — accesibilidad (spec §11)", () => {
	it("es una toolbar con nombre accesible", () => {
		setup();
		expect(
			screen.getByRole("toolbar", { name: "Herramientas de captura" }),
		).toBeInTheDocument();
	});

	it("tiene todos los botones con aria-label, en el orden del spec", () => {
		setup();
		const labels = screen
			.getAllByRole("button")
			.map((b) => b.getAttribute("aria-label"));
		expect(labels).toEqual(ORDEN);
	});

	it("todos los botones tienen aria-label y ninguno lleva title (hay tooltip propio)", () => {
		setup();
		for (const b of screen.getAllByRole("button")) {
			expect(b.getAttribute("aria-label")).toBeTruthy();
			expect(b).not.toHaveAttribute("title");
		}
	});

	it("los íconos SVG no se anuncian (aria-hidden)", () => {
		setup();
		for (const svg of document.querySelectorAll("button svg")) {
			expect(svg).toHaveAttribute("aria-hidden", "true");
		}
	});
});

describe("CaptureToolbar — OCR, traducir y QR (C6)", () => {
	it.each(PROXIMAMENTE)("«%s» se ve y está desactivado", (label) => {
		const props = setup();
		const b = screen.getByRole("button", { name: label });
		expect(b).toBeVisible();
		expect(b).toBeDisabled();
		expect(b).toHaveAttribute("aria-disabled", "true");
		fireEvent.click(b);
		for (const fn of Object.values(props)) {
			if (typeof fn === "function") expect(fn).not.toHaveBeenCalled();
		}
	});

	it.each(PROXIMAMENTE)(
		"«%s» muestra «Próximamente» en el tooltip propio",
		(label) => {
			setup();
			const b = screen.getByRole("button", { name: label });
			fireEvent.mouseEnter(b.parentElement as HTMLElement);
			const tip = document.querySelector("[data-tooltip]");
			expect(tip).toHaveTextContent(label);
			expect(tip).toHaveTextContent("Próximamente");
		},
	);

	it("el teclado no puede enfocarlos: las flechas los saltan", () => {
		setup();
		screen.getByRole("button", { name: "Rehacer" }).focus();
		fireEvent.keyDown(screen.getByRole("button", { name: "Rehacer" }), {
			key: "ArrowRight",
		});
		expect(
			screen.getByRole("button", { name: "Fijar en pantalla" }),
		).toHaveFocus();
	});
});

describe("CaptureToolbar — herramientas", () => {
	it("la herramienta activa lleva aria-pressed=true y las demás false", () => {
		setup({ tool: "ellipse" });
		expect(screen.getByRole("button", { name: "Elipse" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		for (const n of [
			"Rectángulo",
			"Flecha",
			"Lápiz",
			"Texto",
			"Mosaico",
			"Borrador",
		]) {
			expect(screen.getByRole("button", { name: n })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		}
	});

	it("sin herramienta, ninguna está pulsada", () => {
		setup({ tool: null });
		for (const n of [
			"Rectángulo",
			"Elipse",
			"Flecha",
			"Lápiz",
			"Texto",
			"Mosaico",
			"Borrador",
		]) {
			expect(screen.getByRole("button", { name: n })).toHaveAttribute(
				"aria-pressed",
				"false",
			);
		}
	});

	it.each([
		["Rectángulo", "rect"],
		["Elipse", "ellipse"],
		["Flecha", "arrow"],
		["Lápiz", "pen"],
		["Texto", "text"],
		["Mosaico", "mosaic"],
		["Borrador", "eraser"],
	])("clic en «%s» elige %s", (label, tool) => {
		const props = setup();
		fireEvent.click(screen.getByRole("button", { name: label }));
		expect(props.onToolChange).toHaveBeenCalledWith(tool);
	});

	it("clic en la herramienta activa la desactiva", () => {
		const props = setup({ tool: "pen" });
		fireEvent.click(screen.getByRole("button", { name: "Lápiz" }));
		expect(props.onToolChange).toHaveBeenCalledWith(null);
	});
});

describe("CaptureToolbar — deshacer, rehacer y salida", () => {
	it("Deshacer y Rehacer se desactivan según canUndo/canRedo", () => {
		setup({ canUndo: false, canRedo: false });
		expect(screen.getByRole("button", { name: "Deshacer" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Rehacer" })).toBeDisabled();
	});

	it("Deshacer y Rehacer activos disparan sus callbacks", () => {
		const props = setup();
		fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
		fireEvent.click(screen.getByRole("button", { name: "Rehacer" }));
		expect(props.onUndo).toHaveBeenCalledOnce();
		expect(props.onRedo).toHaveBeenCalledOnce();
	});

	it("los cinco botones de salida disparan su callback", () => {
		const props = setup();
		fireEvent.click(screen.getByRole("button", { name: "Fijar en pantalla" }));
		fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
		fireEvent.click(screen.getByRole("button", { name: "Guardar como…" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		fireEvent.click(screen.getByRole("button", { name: "Copiar y cerrar" }));
		expect(props.onPin).toHaveBeenCalledOnce();
		expect(props.onSave).toHaveBeenCalledOnce();
		expect(props.onSaveAs).toHaveBeenCalledOnce();
		expect(props.onCancel).toHaveBeenCalledOnce();
		expect(props.onConfirm).toHaveBeenCalledOnce();
	});

	it("con busy se bloquean fijar, guardar, guardar como y copiar, pero Cancelar sigue activo", () => {
		setup({ busy: true });
		for (const n of [
			"Fijar en pantalla",
			"Guardar",
			"Guardar como…",
			"Copiar y cerrar",
		]) {
			expect(screen.getByRole("button", { name: n })).toBeDisabled();
		}
		expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled();
	});
});

describe("CaptureToolbar — teclado", () => {
	it("ArrowRight/ArrowLeft mueven el foco entre botones activos", () => {
		setup();
		const rect = screen.getByRole("button", { name: "Rectángulo" });
		rect.focus();
		fireEvent.keyDown(rect, { key: "ArrowRight" });
		expect(screen.getByRole("button", { name: "Elipse" })).toHaveFocus();
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
		expect(rect).toHaveFocus();
	});

	it("el foco da la vuelta en los extremos", () => {
		setup();
		const first = screen.getByRole("button", { name: "Seleccionar" });
		first.focus();
		fireEvent.keyDown(first, { key: "ArrowLeft" });
		expect(
			screen.getByRole("button", { name: "Copiar y cerrar" }),
		).toHaveFocus();
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowRight" });
		expect(first).toHaveFocus();
	});

	it("las flechas saltan Deshacer/Rehacer cuando están desactivados", () => {
		setup({ canUndo: false, canRedo: false });
		const borrador = screen.getByRole("button", { name: "Borrador" });
		borrador.focus();
		fireEvent.keyDown(borrador, { key: "ArrowRight" });
		expect(
			screen.getByRole("button", { name: "Fijar en pantalla" }),
		).toHaveFocus();
	});

	it("otras teclas no mueven el foco", () => {
		setup();
		const rect = screen.getByRole("button", { name: "Rectángulo" });
		rect.focus();
		fireEvent.keyDown(rect, { key: "ArrowDown" });
		expect(rect).toHaveFocus();
	});
});

describe("CaptureToolbar — atajos visibles", () => {
	it("cada herramienta declara aria-keyshortcuts y conserva su aria-label", () => {
		setup();
		const casos: [string, string][] = [
			["Seleccionar", "Alt+H H V"],
			["Rectángulo", "Alt+R R"],
			["Elipse", "Alt+O O"],
			["Flecha", "Alt+F F"],
			["Lápiz", "Alt+L L"],
			["Texto", "Alt+T T"],
			["Mosaico", "Alt+M M"],
			["Borrador", "Alt+B B"],
		];
		for (const [name, keys] of casos) {
			const b = screen.getByRole("button", { name });
			expect(b).toHaveAttribute("aria-keyshortcuts", keys);
			expect(b).toHaveAttribute("aria-label", name);
			expect(b).not.toHaveAttribute("title");
		}
	});

	it("el tooltip propio aparece con el ratón, con nombre y atajo, oculto a lectores de pantalla", () => {
		setup();
		expect(document.querySelector("[data-tooltip]")).toBeNull();
		const wrap = screen.getByRole("button", { name: "Flecha" })
			.parentElement as HTMLElement;
		fireEvent.mouseEnter(wrap);
		const tip = document.querySelector("[data-tooltip]") as HTMLElement;
		expect(tip).toHaveAttribute("aria-hidden", "true");
		expect(tip).toHaveTextContent("Flecha");
		expect(tip).toHaveTextContent("Alt+F · F");
		fireEvent.mouseLeave(wrap);
		expect(document.querySelector("[data-tooltip]")).toBeNull();
	});

	it("también aparece con el foco de teclado y se va al perder el foco", () => {
		setup();
		// jsdom no distingue el foco de teclado: se simula como lo haría un navegador.
		const matches = Element.prototype.matches;
		vi.spyOn(Element.prototype, "matches").mockImplementation(function (
			this: Element,
			sel: string,
		) {
			return sel === ":focus-visible" ? true : matches.call(this, sel);
		});
		const b = screen.getByRole("button", { name: "Guardar" });
		act(() => b.focus());
		expect(document.querySelector("[data-tooltip]")).toHaveTextContent(
			"Ctrl+S",
		);
		act(() => b.blur());
		expect(document.querySelector("[data-tooltip]")).toBeNull();
	});

	it("Esc lo cierra sin llegar a los atajos (no cancela la captura); el siguiente Esc sí llega", () => {
		setup();
		const heard = vi.fn();
		document.addEventListener("keydown", heard);
		const wrap = screen.getByRole("button", { name: "Flecha" })
			.parentElement as HTMLElement;
		fireEvent.mouseEnter(wrap);
		const first = fireEvent.keyDown(document.body, { key: "Escape" });
		expect(first).toBe(false);
		expect(heard).not.toHaveBeenCalled();
		expect(document.querySelector("[data-tooltip]")).toBeNull();
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(heard).toHaveBeenCalledOnce();
		document.removeEventListener("keydown", heard);
	});

	describe("posición", () => {
		function tooltipAt(rect: Partial<DOMRect>) {
			vi.spyOn(
				HTMLElement.prototype,
				"getBoundingClientRect",
			).mockImplementation(function (this: HTMLElement) {
				return this.hasAttribute("data-tooltip")
					? ({
							left: 100,
							right: 220,
							top: 0,
							bottom: 20,
							width: 120,
							height: 20,
							...rect,
						} as DOMRect)
					: ({
							left: 0,
							right: 0,
							top: 0,
							bottom: 0,
							width: 0,
							height: 0,
						} as DOMRect);
			});
			setup();
			fireEvent.mouseEnter(
				screen.getByRole("button", { name: "Flecha" })
					.parentElement as HTMLElement,
			);
			return document.querySelector("[data-tooltip]") as HTMLElement;
		}

		it("por defecto va debajo del botón, separado de la píldora", () => {
			const tip = tooltipAt({});
			expect(tip.className).toContain("top-full");
			expect(tip.className).toContain("mt-3");
		});

		it("si no cabe debajo, se coloca encima", () => {
			const tip = tooltipAt({ bottom: window.innerHeight + 30 });
			expect(tip.className).toContain("bottom-full");
		});

		it("si se sale por la izquierda, se desplaza hacia dentro", () => {
			const tip = tooltipAt({ left: -20, right: 100 });
			expect(tip.style.transform).toContain("+ 28px");
		});

		it("si se sale por la derecha, se desplaza hacia dentro", () => {
			const tip = tooltipAt({
				left: window.innerWidth - 20,
				right: window.innerWidth + 100,
			});
			expect(tip.style.transform).toContain("-108px");
		});
	});

	it("Deshacer, Guardar, Cancelar y Copiar también declaran su atajo", () => {
		setup();
		expect(screen.getByRole("button", { name: "Deshacer" })).toHaveAttribute(
			"aria-keyshortcuts",
			"Control+Z",
		);
		expect(screen.getByRole("button", { name: "Guardar" })).toHaveAttribute(
			"aria-keyshortcuts",
			"Control+S",
		);
		expect(screen.getByRole("button", { name: "Cancelar" })).toHaveAttribute(
			"aria-keyshortcuts",
			"Escape",
		);
		expect(
			screen.getByRole("button", { name: "Copiar y cerrar" }),
		).toHaveAttribute("aria-keyshortcuts", "Enter Control+C");
	});

	it("los botones «Próximamente» no muestran tooltip de atajo", () => {
		setup();
		expect(
			screen.queryByText("Extraer texto (OCR)", { selector: "span span" }),
		).toBeNull();
	});
});
