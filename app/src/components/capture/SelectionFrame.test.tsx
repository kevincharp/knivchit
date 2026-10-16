import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SelectionFrame } from "./SelectionFrame";

afterEach(cleanup);

const bounds = { w: 1000, h: 800 };

function setup(
	over: Partial<React.ComponentProps<typeof SelectionFrame>> = {},
) {
	const onChange = vi.fn();
	const view = render(
		<SelectionFrame
			selection={{ x: 100, y: 100, w: 200, h: 150 }}
			scale={{ x: 1, y: 1 }}
			bounds={bounds}
			viewport={bounds}
			canMove
			onChange={onChange}
			{...over}
		/>,
	);
	return { view, onChange, frame: screen.getByRole("button") };
}

describe("SelectionFrame — dimensiones y manijas (C2)", () => {
	it("muestra la etiqueta «ancho × alto» y la anuncia en el aria-label", () => {
		const { frame } = setup();
		expect(screen.getByText("200 × 150")).toBeVisible();
		expect(frame.getAttribute("aria-label")).toContain("200 por 150 píxeles");
	});

	it("tiene exactamente las 8 manijas, con el cursor correcto", () => {
		const { view } = setup();
		const cursores: Record<string, string> = {
			nw: "nwse-resize",
			se: "nwse-resize",
			ne: "nesw-resize",
			sw: "nesw-resize",
			n: "ns-resize",
			s: "ns-resize",
			e: "ew-resize",
			w: "ew-resize",
		};
		const manijas =
			view.container.querySelectorAll<HTMLElement>("[data-handle]");
		expect(manijas).toHaveLength(8);
		for (const m of manijas) {
			expect(m.style.cursor).toBe(cursores[m.dataset.handle as string]);
		}
	});

	it("las manijas se colocan en esquinas y puntos medios (con escala)", () => {
		const { view } = setup({ scale: { x: 2, y: 2 } });
		const pos = (id: string) => {
			const m = view.container.querySelector<HTMLElement>(
				`[data-handle=${id}]`,
			);
			return [m?.style.left, m?.style.top];
		};
		// selección en pantalla: x 200..600, y 200..500
		expect(pos("nw")).toEqual(["200px", "200px"]);
		expect(pos("se")).toEqual(["600px", "500px"]);
		expect(pos("n")).toEqual(["400px", "200px"]);
		expect(pos("w")).toEqual(["200px", "350px"]);
	});

	it("la etiqueta pasa dentro de la selección si está pegada al borde superior", () => {
		setup({ selection: { x: 100, y: 5, w: 200, h: 150 } });
		const etiqueta = screen.getByText("200 × 150");
		expect(Number.parseFloat(etiqueta.style.top)).toBeGreaterThanOrEqual(5);
	});

	it("no usa box-shadow en ningún elemento", () => {
		const { view } = setup();
		for (const el of view.container.querySelectorAll<HTMLElement>("*")) {
			expect(el.style.boxShadow).toBe("");
		}
	});
});

describe("SelectionFrame — mover y redimensionar", () => {
	it("flechas mueven 1 px, con Shift 10 px", () => {
		const { frame, onChange } = setup();
		fireEvent.keyDown(frame, { key: "ArrowRight" });
		expect(onChange).toHaveBeenLastCalledWith({
			x: 101,
			y: 100,
			w: 200,
			h: 150,
		});
		fireEvent.keyDown(frame, { key: "ArrowDown", shiftKey: true });
		expect(onChange).toHaveBeenLastCalledWith({
			x: 100,
			y: 110,
			w: 200,
			h: 150,
		});
	});

	it("Ctrl+flechas redimensiona sin mover el origen", () => {
		const { frame, onChange } = setup();
		fireEvent.keyDown(frame, { key: "ArrowRight", ctrlKey: true });
		expect(onChange).toHaveBeenLastCalledWith({
			x: 100,
			y: 100,
			w: 201,
			h: 150,
		});
		fireEvent.keyDown(frame, { key: "ArrowUp", ctrlKey: true, shiftKey: true });
		expect(onChange).toHaveBeenLastCalledWith({
			x: 100,
			y: 100,
			w: 200,
			h: 140,
		});
	});

	it("las flechas no sacan la selección de la imagen", () => {
		const { frame, onChange } = setup({
			selection: { x: 0, y: 0, w: 200, h: 150 },
		});
		fireEvent.keyDown(frame, { key: "ArrowLeft", shiftKey: true });
		expect(onChange).toHaveBeenLastCalledWith({ x: 0, y: 0, w: 200, h: 150 });
	});

	it("otras teclas no hacen nada", () => {
		const { frame, onChange } = setup();
		fireEvent.keyDown(frame, { key: "a" });
		expect(onChange).not.toHaveBeenCalled();
	});

	it("sin canMove (herramienta de dibujo activa) el cuerpo no recibe el ratón", () => {
		const { frame } = setup({ canMove: false });
		expect(frame.style.pointerEvents).toBe("none");
	});

	it("con canMove el cuerpo recibe el ratón", () => {
		const { frame } = setup();
		expect(frame.style.pointerEvents).toBe("auto");
	});
});

describe("SelectionFrame — anti arrastre nativo", () => {
	it("el pointerdown del cuerpo y de las manijas se cancela", () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		const { frame, view } = setup();
		expect(fireEvent.pointerDown(frame, { button: 0, pointerId: 1 })).toBe(
			false,
		);
		const manija = view.container.querySelector(
			"[data-handle=se]",
		) as HTMLElement;
		expect(fireEvent.pointerDown(manija, { button: 0, pointerId: 1 })).toBe(
			false,
		);
	});
});

describe("SelectionFrame — cursor", () => {
	it("el cuerpo es `move`, pasa a `grabbing` mientras se arrastra y vuelve a `move`", () => {
		HTMLElement.prototype.setPointerCapture = vi.fn();
		const { frame } = setup();
		expect(frame.style.cursor).toBe("move");
		fireEvent.pointerDown(frame, { button: 0, pointerId: 1 });
		expect(frame.style.cursor).toBe("grabbing");
		fireEvent.pointerUp(frame, { pointerId: 1 });
		expect(frame.style.cursor).toBe("move");
	});

	it("con una herramienta activa el cuerpo muestra la cruz", () => {
		const { frame } = setup({ canMove: false });
		expect(frame.style.cursor).toBe("crosshair");
	});
});
