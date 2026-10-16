import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCapturePreview: vi.fn(),
	cancelCapture: vi.fn(),
	close: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
	getCapturePreview: m.getCapturePreview,
	cancelCapture: m.cancelCapture,
	copyCapture: vi.fn(),
	saveCapture: vi.fn(),
	saveCaptureAs: vi.fn(),
	pinCapture: vi.fn(),
	captureActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		show: vi.fn(),
		setFocus: vi.fn(),
		close: m.close,
	}),
}));
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ setFocus: vi.fn().mockResolvedValue(undefined) }),
}));

import { CaptureOverlay } from "./CaptureOverlay";

/**
 * Enrutado de gestos por capas con «Seleccionar». La figura gana al marco del
 * área de captura; el marco solo se mueve desde su interior VACÍO y se
 * redimensiona desde sus manijas.
 *
 * jsdom no hace hit-testing por layout: `topmostAt` lo emula con el orden de
 * apilado real del overlay (manijas del área > cuerpo del área > canvas de
 * anotaciones) y respetando `pointer-events`. Así el test vale tanto si el
 * arreglo enruta por CSS como si enruta por código.
 *
 * Los tests `bug(...)` fijaron el defecto (rojo contra 55aa4bb); ya están
 * activos tras el arreglo.
 */
const bug = it;

// Selección en pantalla (scale 1): x 100..500, y 100..400.
const SEL = { left: 100, top: 100, width: 400, height: 300 };

let ctx: CanvasRenderingContext2D;
let rafQueue: FrameRequestCallback[];

function flushFrames() {
	act(() => {
		const pending = rafQueue.splice(0, rafQueue.length);
		for (const cb of pending) cb(0);
	});
}

beforeEach(() => {
	m.getCapturePreview.mockReset().mockResolvedValue("data:image/png;base64,x");
	m.cancelCapture.mockReset().mockResolvedValue(undefined);
	m.close.mockReset().mockResolvedValue(undefined);

	Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
		configurable: true,
		get: () => window.innerWidth,
	});
	Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
		configurable: true,
		get: () => window.innerHeight,
	});
	// Sin layout en jsdom la toolbar mediría 0 y quedaría oculta (visibility: hidden).
	Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
		configurable: true,
		get: () => 300,
	});
	Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
		configurable: true,
		get: () => 40,
	});
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);

	const store: Record<string, unknown> = {};
	ctx = new Proxy(store, {
		get: (t, k: string) => {
			if (!(k in t)) t[k] = vi.fn();
			return t[k];
		},
		set: (t, k: string, v) => {
			t[k] = v;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
	vi.spyOn(
		HTMLCanvasElement.prototype,
		"getBoundingClientRect",
	).mockReturnValue({
		...SEL,
		right: 500,
		bottom: 400,
		x: 100,
		y: 100,
	} as DOMRect);

	rafQueue = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
		rafQueue.push(cb);
		return rafQueue.length;
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function canvasOf(container: HTMLElement) {
	return container.querySelector("canvas") as HTMLCanvasElement;
}

async function mountWithSelection() {
	const view = render(<CaptureOverlay />);
	const img = await waitFor(() => {
		const el = view.container.querySelector("img");
		if (!el) throw new Error("aún sin img");
		return el;
	});
	fireEvent.load(img);
	const root = view.container.firstElementChild as HTMLElement;
	fireEvent.pointerDown(root, {
		pointerId: 1,
		button: 0,
		clientX: 100,
		clientY: 100,
	});
	fireEvent.pointerMove(root, { pointerId: 1, clientX: 500, clientY: 400 });
	fireEvent.pointerUp(root, { pointerId: 1, clientX: 500, clientY: 400 });
	return { ...view, root };
}

const areaFrame = () =>
	screen.getByRole("button", { name: /^Área de captura/ }) as HTMLElement;
const areaPos = () => [
	Number.parseFloat(areaFrame().style.left),
	Number.parseFloat(areaFrame().style.top),
];
const areaLabel = () => areaFrame().getAttribute("aria-label")?.split(".")[0];

/** Elemento que recibiría un puntero en (x,y), de arriba abajo. */
function topmostAt(container: HTMLElement, x: number, y: number): Element {
	for (const h of container.querySelectorAll<HTMLElement>("[data-handle]")) {
		const cx = Number.parseFloat(h.style.left);
		const cy = Number.parseFloat(h.style.top);
		if (
			h.style.pointerEvents !== "none" &&
			Math.abs(x - cx) <= 10 &&
			Math.abs(y - cy) <= 10
		) {
			return h;
		}
	}
	const [left, top] = areaPos();
	const inArea =
		x >= left && x <= left + SEL.width && y >= top && y <= top + SEL.height;
	if (inArea && areaFrame().style.pointerEvents !== "none") return areaFrame();
	if (inArea) return canvasOf(container);
	return container.firstElementChild as Element;
}

/** Arrastra como lo haría el navegador: el gesto entero va al elemento bajo el puntero inicial. */
function dragReal(
	container: HTMLElement,
	from: [number, number],
	to: [number, number],
) {
	const el = topmostAt(container, from[0], from[1]);
	fireEvent.pointerDown(el, {
		pointerId: 1,
		button: 0,
		clientX: from[0],
		clientY: from[1],
	});
	fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
	flushFrames();
	fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
	flushFrames();
}

const manija = (container: HTMLElement, id: string) => {
	const el = container.querySelector<HTMLElement>(
		`[data-annotation-handle=${id}]`,
	);
	if (!el) throw new Error(`sin manija ${id} de la figura`);
	return [Number.parseFloat(el.style.left), Number.parseFloat(el.style.top)];
};

/** Rectángulo (150,150)-(300,250) con Seleccionar activo y la figura elegida. */
async function withSelectedRect() {
	const view = await mountWithSelection();
	fireEvent.click(screen.getByRole("button", { name: "Rectángulo" }));
	dragReal(view.container, [150, 150], [300, 250]);
	fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
	dragReal(view.container, [150, 200], [150, 200]);
	return view;
}

/** Flecha de (105,105) a (300,250): su inicio queda bajo la manija nw del área. */
async function withSelectedArrowNearCorner() {
	const view = await mountWithSelection();
	fireEvent.click(screen.getByRole("button", { name: "Flecha" }));
	// Se dibuja directo sobre el canvas: aquí interesa la edición, no el trazado.
	const canvas = canvasOf(view.container);
	fireEvent.pointerDown(canvas, {
		pointerId: 1,
		button: 0,
		clientX: 105,
		clientY: 105,
	});
	fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 300, clientY: 250 });
	fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 300, clientY: 250 });
	fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
	// Punto medio de la flecha: (202.5, 177.5).
	dragReal(view.container, [202, 177], [202, 177]);
	return view;
}

describe("Seleccionar — la figura gana al marco del área (bug 2)", () => {
	it("arrastrar el cuerpo de una figura la mueve y NO mueve ni redimensiona el área", async () => {
		const view = await withSelectedRect();
		const area = areaPos();
		const label = areaLabel();
		const nw = manija(view.container, "nw");

		dragReal(view.container, [150, 175], [210, 205]);

		expect(manija(view.container, "nw")).toEqual([nw[0] + 60, nw[1] + 30]);
		expect(areaPos()).toEqual(area);
		expect(areaLabel()).toBe(label);
	});

	bug(
		"una figura bajo una manija del área se agarra a ella: su extremo se mueve y el área no cambia",
		async () => {
			const view = await withSelectedArrowNearCorner();
			const area = areaPos();
			const label = areaLabel();
			// El inicio de la flecha (105,105) queda dentro de los 20×20 de la manija nw del área (100,100).
			expect(manija(view.container, "start")).toEqual([5, 5]);

			dragReal(view.container, [105, 105], [125, 130]);

			expect(manija(view.container, "start")).toEqual([25, 30]);
			expect(areaPos()).toEqual(area);
			expect(areaLabel()).toBe(label);
		},
	);

	bug(
		"una flecha que corre por el borde del área, bajo la manija «w», se mueve entera y no redimensiona el área",
		async () => {
			const view = await mountWithSelection();
			fireEvent.click(screen.getByRole("button", { name: "Flecha" }));
			const canvas = canvasOf(view.container);
			fireEvent.pointerDown(canvas, {
				pointerId: 1,
				button: 0,
				clientX: 102,
				clientY: 150,
			});
			fireEvent.pointerMove(canvas, {
				pointerId: 1,
				clientX: 102,
				clientY: 350,
			});
			fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 102, clientY: 350 });
			fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
			// Se elige directo sobre el canvas: la elección también la tapa la manija.
			fireEvent.pointerDown(canvas, {
				pointerId: 1,
				button: 0,
				clientX: 102,
				clientY: 200,
			});
			fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 102, clientY: 200 });
			const area = areaPos();
			const label = areaLabel();

			// (102,250) está en el cuerpo de la flecha y dentro de los 20×20 de la manija «w» (100,250).
			dragReal(view.container, [102, 250], [142, 260]);

			expect(manija(view.container, "start")).toEqual([42, 60]);
			expect(manija(view.container, "end")).toEqual([42, 260]);
			expect(areaPos()).toEqual(area);
			expect(areaLabel()).toBe(label);
		},
	);
});

describe("Seleccionar — el marco del área sigue funcionando (criterio 3)", () => {
	bug(
		"un gesto que empieza en vacío dentro del marco mueve el área",
		async () => {
			const view = await withSelectedRect();
			const [left, top] = areaPos();

			dragReal(view.container, [420, 350], [450, 370]);

			expect(areaPos()).toEqual([left + 30, top + 20]);
		},
	);

	it("las manijas del área redimensionan el área aunque haya una figura elegida", async () => {
		const view = await withSelectedRect();

		dragReal(view.container, [500, 400], [520, 430]);

		expect(areaLabel()).toBe("Área de captura, 420 por 330 píxeles");
	});

	it("un clic en vacío dentro del marco deselecciona la figura sin mover el área", async () => {
		const view = await withSelectedRect();
		const area = areaPos();

		dragReal(view.container, [420, 350], [420, 350]);

		expect(screen.queryByTestId("annotation-selection")).toBeNull();
		expect(areaPos()).toEqual(area);
	});
});
