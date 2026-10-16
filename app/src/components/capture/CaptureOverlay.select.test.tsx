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

import { copyCapture } from "../../lib/tauri";
import { TEXT_RIGHT_MARGIN } from "./annotations";
import { CaptureOverlay } from "./CaptureOverlay";

const RED = "#ff0000";
const BLUE = "#0000ff";

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

	document.documentElement.style.setProperty("--color-ann-red", RED);
	document.documentElement.style.setProperty("--color-ann-blue", BLUE);

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
	document.documentElement.style.removeProperty("--color-ann-red");
	document.documentElement.style.removeProperty("--color-ann-blue");
});

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

function canvasOf(container: HTMLElement) {
	return container.querySelector("canvas") as HTMLCanvasElement;
}

function drag(
	el: Element,
	from: [number, number],
	to: [number, number],
	pointerId = 1,
) {
	fireEvent.pointerDown(el, {
		pointerId,
		button: 0,
		clientX: from[0],
		clientY: from[1],
	});
	fireEvent.pointerMove(el, { pointerId, clientX: to[0], clientY: to[1] });
	fireEvent.pointerUp(el, { pointerId, clientX: to[0], clientY: to[1] });
}

/** Dibuja un rectángulo rojo de (150,150) a (300,250) y deja «Seleccionar» activo sin elegir nada. */
async function drawRectThenSelectTool() {
	const view = await mountWithSelection();
	fireEvent.click(screen.getByRole("button", { name: "Rectángulo" }));
	drag(canvasOf(view.container), [150, 150], [300, 250]);
	fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
	return view;
}

const undoBtn = () => screen.getByRole("button", { name: /Deshacer/i });
const redoBtn = () => screen.getByRole("button", { name: /Rehacer/i });

describe("CaptureOverlay — herramienta Seleccionar (integración)", () => {
	it("la tecla V alterna Seleccionar y la segunda pulsación la deja", async () => {
		await mountWithSelection();
		const btn = () => screen.getByRole("button", { name: "Seleccionar" });
		fireEvent.keyDown(document, { key: "v", code: "KeyV" });
		expect(btn()).toHaveAttribute("aria-pressed", "true");
		fireEvent.keyDown(document, { key: "v", code: "KeyV" });
		expect(btn()).toHaveAttribute("aria-pressed", "false");
	});

	it("clic sobre una anotación la selecciona (marco con manijas)", async () => {
		const view = await drawRectThenSelectTool();
		expect(screen.queryByTestId("annotation-selection")).toBeNull();
		drag(canvasOf(view.container), [150, 200], [150, 200]);
		expect(screen.getByTestId("annotation-selection")).toBeInTheDocument();
	});

	it("Esc deselecciona primero y, sin selección, cancela la captura", async () => {
		const view = await drawRectThenSelectTool();
		drag(canvasOf(view.container), [150, 200], [150, 200]);
		expect(screen.getByTestId("annotation-selection")).toBeInTheDocument();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByTestId("annotation-selection")).toBeNull();
		expect(m.cancelCapture).not.toHaveBeenCalled();

		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(m.cancelCapture).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(m.close).toHaveBeenCalledTimes(1));
	});

	it("Supr borra la seleccionada y se puede deshacer y rehacer", async () => {
		const view = await drawRectThenSelectTool();
		const canvas = canvasOf(view.container);
		drag(canvas, [150, 200], [150, 200]);
		const strokeRect = ctx.strokeRect as unknown as ReturnType<typeof vi.fn>;
		flushFrames();

		fireEvent.keyDown(document, { key: "Delete" });
		expect(screen.queryByTestId("annotation-selection")).toBeNull();
		strokeRect.mockClear();
		flushFrames();
		expect(strokeRect).not.toHaveBeenCalled();

		fireEvent.click(undoBtn());
		flushFrames();
		expect(strokeRect).toHaveBeenCalled();
		expect(redoBtn()).toBeEnabled();

		strokeRect.mockClear();
		fireEvent.click(redoBtn());
		flushFrames();
		expect(strokeRect).not.toHaveBeenCalled();
		expect(redoBtn()).toBeDisabled();
	});

	// Regresión: un clic sin arrastre no debe commitear un paso vacío ni borrar lo rehacible.
	it("un clic sin mover sobre una anotación no crea un paso de historial ni borra el rehacer", async () => {
		const view = await drawRectThenSelectTool();
		const canvas = canvasOf(view.container);
		drag(canvas, [150, 200], [150, 200]);
		fireEvent.keyDown(document, { key: "Delete" });
		fireEvent.click(undoBtn());
		expect(redoBtn()).toBeEnabled();

		drag(canvas, [150, 200], [150, 200]);

		expect(redoBtn()).toBeEnabled();
	});

	it("elegir otro color cambia la anotación seleccionada y deshacer lo revierte", async () => {
		const view = await drawRectThenSelectTool();
		drag(canvasOf(view.container), [150, 200], [150, 200]);

		flushFrames();
		expect((ctx as unknown as { strokeStyle: string }).strokeStyle).toBe(RED);

		fireEvent.click(screen.getByRole("radio", { name: "Azul" }));
		flushFrames();
		expect((ctx as unknown as { strokeStyle: string }).strokeStyle).toBe(BLUE);

		fireEvent.click(undoBtn());
		flushFrames();
		expect((ctx as unknown as { strokeStyle: string }).strokeStyle).toBe(RED);
	});

	it("elegir otro grosor cambia la anotación seleccionada y deshacer lo revierte", async () => {
		const view = await drawRectThenSelectTool();
		drag(canvasOf(view.container), [150, 200], [150, 200]);

		flushFrames();
		expect((ctx as unknown as { lineWidth: number }).lineWidth).toBe(4);

		fireEvent.click(screen.getByRole("radio", { name: "Grueso" }));
		flushFrames();
		expect((ctx as unknown as { lineWidth: number }).lineWidth).toBe(8);

		fireEvent.click(undoBtn());
		flushFrames();
		expect((ctx as unknown as { lineWidth: number }).lineWidth).toBe(4);
	});

	it("mover la anotación es un solo paso: deshacer y rehacer la devuelven y la reponen", async () => {
		const view = await drawRectThenSelectTool();
		const canvas = canvasOf(view.container);
		drag(canvas, [150, 200], [150, 200]);

		// Arrastrar desde el borde izquierdo (x=150) 60 px a la derecha.
		drag(canvas, [150, 200], [210, 200]);
		const strokeRect = ctx.strokeRect as unknown as ReturnType<typeof vi.fn>;
		flushFrames();
		const movedX = strokeRect.mock.calls[
			strokeRect.mock.calls.length - 1
		]?.[0] as number;
		expect(movedX).toBe(210);

		fireEvent.click(undoBtn());
		flushFrames();
		const undoneX = strokeRect.mock.calls[
			strokeRect.mock.calls.length - 1
		]?.[0] as number;
		expect(undoneX).toBe(movedX - 60);

		fireEvent.click(redoBtn());
		flushFrames();
		expect(strokeRect.mock.calls[strokeRect.mock.calls.length - 1]?.[0]).toBe(
			movedX,
		);
	});

	it("redimensionar con una manija es un solo paso deshacible", async () => {
		const view = await drawRectThenSelectTool();
		const canvas = canvasOf(view.container);
		drag(canvas, [150, 200], [150, 200]);

		// Manija de la esquina inferior derecha (300,250) → (340,290).
		drag(canvas, [300, 250], [340, 290]);
		const strokeRect = ctx.strokeRect as unknown as ReturnType<typeof vi.fn>;
		flushFrames();
		const [, , w1, h1] = strokeRect.mock.calls[
			strokeRect.mock.calls.length - 1
		] as number[];

		fireEvent.click(undoBtn());
		flushFrames();
		const [, , w0, h0] = strokeRect.mock.calls[
			strokeRect.mock.calls.length - 1
		] as number[];
		expect(w1 - w0).toBe(40);
		expect(h1 - h0).toBe(40);

		// Un solo deshacer basta: el siguiente ya no tiene historial de la manija.
		fireEvent.click(redoBtn());
		flushFrames();
		const [, , w2, h2] = strokeRect.mock.calls[
			strokeRect.mock.calls.length - 1
		] as number[];
		expect([w2, h2]).toEqual([w1, h1]);
	});
});

describe("barra de título propia", () => {
	it("el overlay de captura no monta la barra de la ventana principal", async () => {
		const view = await mountWithSelection();
		expect(view.container.querySelector("header")).toBeNull();
		expect(screen.queryByRole("button", { name: "Minimizar" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Cerrar" })).toBeNull();
	});
});

describe("CaptureOverlay — atajos de herramienta", () => {
	const pressed = (name: string) =>
		screen.getByRole("button", { name }).getAttribute("aria-pressed");

	it.each([
		["KeyH", "Seleccionar"],
		["KeyR", "Rectángulo"],
		["KeyO", "Elipse"],
		["KeyF", "Flecha"],
		["KeyL", "Lápiz"],
		["KeyT", "Texto"],
		["KeyM", "Mosaico"],
		["KeyB", "Borrador"],
	])("Alt+%s activa «%s» y repetirlo la apaga", async (code, name) => {
		await mountWithSelection();
		fireEvent.keyDown(document, { key: "x", code, altKey: true });
		expect(pressed(name)).toBe("true");
		fireEvent.keyDown(document, { key: "x", code, altKey: true });
		expect(pressed(name)).toBe("false");
	});

	it("la letra sola también elige herramienta y cambia de una a otra", async () => {
		await mountWithSelection();
		fireEvent.keyDown(document, { key: "f", code: "KeyF" });
		expect(pressed("Flecha")).toBe("true");
		fireEvent.keyDown(document, { key: "r", code: "KeyR" });
		expect(pressed("Rectángulo")).toBe("true");
		expect(pressed("Flecha")).toBe("false");
	});

	it("Ctrl+letra no cambia de herramienta", async () => {
		await mountWithSelection();
		fireEvent.keyDown(document, { key: "r", code: "KeyR", ctrlKey: true });
		expect(pressed("Rectángulo")).toBe("false");
	});

	it("escribiendo un texto la letra sola es texto y Alt+letra confirma el texto y cambia de herramienta", async () => {
		const view = await mountWithSelection();
		fireEvent.click(screen.getByRole("button", { name: "Texto" }));
		fireEvent.pointerDown(canvasOf(view.container), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 150,
		});
		const area = screen.getByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement;
		area.focus();
		area.value = "hola";
		fireEvent.keyDown(area, { key: "r", code: "KeyR" });
		expect(pressed("Rectángulo")).toBe("false");
		expect(pressed("Texto")).toBe("true");

		fireEvent.keyDown(area, { key: "r", code: "KeyR", altKey: true });
		expect(pressed("Rectángulo")).toBe("true");
		expect(screen.queryByLabelText("Texto de la anotación")).toBeNull();
		flushFrames();
		expect(ctx.fillText).toHaveBeenCalledWith(
			"hola",
			expect.any(Number),
			expect.any(Number),
		);
	});

	it("«?» abre la ayuda con las herramientas; Esc la cierra sin cancelar la captura", async () => {
		await mountWithSelection();
		fireEvent.keyDown(document, { key: "?", code: "Slash", shiftKey: true });
		const help = screen.getByRole("region", { name: "Atajos del editor" });
		expect(help).toHaveTextContent("Alt+F");
		expect(help).toHaveTextContent("Seleccionar");
		fireEvent.keyDown(document, { key: "Escape" });
		expect(
			screen.queryByRole("region", { name: "Atajos del editor" }),
		).toBeNull();
		expect(m.cancelCapture).not.toHaveBeenCalled();
	});

	it("sin selección, el atajo no hace nada", async () => {
		render(<CaptureOverlay />);
		await waitFor(() => expect(document.querySelector("img")).not.toBeNull());
		fireEvent.keyDown(document, { key: "r", code: "KeyR", altKey: true });
		expect(screen.queryByRole("button", { name: "Rectángulo" })).toBeNull();
	});
});

describe("CaptureOverlay — Seleccionar: la figura gana al marco del área", () => {
	const areaBtn = () =>
		screen.getByRole("button", { name: /^Área de captura/ });
	const areaLeft = () => areaBtn().style.left;

	/** Como `drag`, pero deja pasar un frame antes de soltar (el marco agrupa el arrastre por frame). */
	function dragFrames(
		el: Element,
		from: [number, number],
		to: [number, number],
	) {
		fireEvent.pointerDown(el, {
			pointerId: 1,
			button: 0,
			clientX: from[0],
			clientY: from[1],
		});
		fireEvent.pointerMove(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
		flushFrames();
		fireEvent.pointerUp(el, { pointerId: 1, clientX: to[0], clientY: to[1] });
	}

	/** Flecha desde la esquina noroeste del área (donde está su manija) y Seleccionar activo. */
	async function arrowOnAreaCorner() {
		const view = await mountWithSelection();
		fireEvent.click(screen.getByRole("button", { name: "Flecha" }));
		drag(canvasOf(view.container), [105, 105], [300, 250]);
		fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
		return view;
	}

	it("un gesto que empieza sobre una figura que cubre una manija del área NO redimensiona el área", async () => {
		const view = await arrowOnAreaCorner();
		const before = areaBtn().getAttribute("aria-label");
		const nw = view.container.querySelector('[data-handle="nw"]') as Element;
		dragFrames(nw, [105, 105], [140, 140]);
		expect(areaBtn().getAttribute("aria-label")).toBe(before);
		expect(areaLeft()).toBe("100px");
		// …y sí mueve la figura: queda seleccionada y la edición es un paso deshacible.
		expect(screen.getByTestId("annotation-selection")).toBeInTheDocument();
		expect(undoBtn()).toBeEnabled();
	});

	it("un gesto que empieza en vacío dentro del marco mueve el área", async () => {
		await arrowOnAreaCorner();
		// El cuerpo del marco tiene que recibir el gesto (no `pointer-events: none`).
		expect(areaBtn().style.pointerEvents).toBe("auto");
		dragFrames(areaBtn(), [400, 350], [430, 360]);
		expect(areaLeft()).toBe("130px");
	});

	it("las manijas del área siguen redimensionándola cuando no hay figura debajo", async () => {
		const view = await arrowOnAreaCorner();
		const se = view.container.querySelector('[data-handle="se"]') as Element;
		dragFrames(se, [500, 400], [480, 380]);
		expect(areaBtn().getAttribute("aria-label")).toContain("380 por 280");
	});

	it("un clic en vacío con Seleccionar deselecciona la figura", async () => {
		const view = await arrowOnAreaCorner();
		// Lejos de la flecha (105,105)→(300,250) y de sus extremos.
		drag(canvasOf(view.container), [450, 150], [450, 150]);
		expect(screen.queryByTestId("annotation-selection")).toBeNull();
	});
});

describe("CaptureOverlay — Seleccionar: editar figuras con sus manijas", () => {
	// El área empieza en (100,100) con escala 1: coordenadas locales = pantalla − 100.
	function handlePos(container: HTMLElement, id: string): [number, number] {
		const el = container.querySelector(
			`[data-annotation-handle="${id}"]`,
		) as HTMLElement;
		return [Number.parseFloat(el.style.left), Number.parseFloat(el.style.top)];
	}

	async function withShape(
		tool: "Flecha" | "Rectángulo" | "Elipse" | "Mosaico",
		from: [number, number],
		to: [number, number],
		pick: [number, number],
	) {
		const view = await mountWithSelection();
		fireEvent.click(screen.getByRole("button", { name: tool }));
		drag(canvasOf(view.container), from, to);
		fireEvent.click(screen.getByRole("button", { name: "Seleccionar" }));
		drag(canvasOf(view.container), pick, pick);
		return view;
	}

	it("flecha: cada extremo se mueve por separado (orientación y longitud)", async () => {
		const view = await withShape("Flecha", [150, 150], [300, 250], [225, 200]);
		const canvas = canvasOf(view.container);
		expect(handlePos(view.container, "start")).toEqual([50, 50]);
		expect(handlePos(view.container, "end")).toEqual([200, 150]);

		drag(canvas, [300, 250], [340, 200]);
		expect(handlePos(view.container, "end")).toEqual([240, 100]);
		expect(handlePos(view.container, "start")).toEqual([50, 50]);

		drag(canvas, [150, 150], [120, 170]);
		expect(handlePos(view.container, "start")).toEqual([20, 70]);
		expect(handlePos(view.container, "end")).toEqual([240, 100]);
	});

	it("rectángulo: la esquina se redimensiona y la opuesta queda fija", async () => {
		const view = await withShape(
			"Rectángulo",
			[150, 150],
			[300, 250],
			[150, 200],
		);
		drag(canvasOf(view.container), [150, 150], [130, 120]);
		expect(handlePos(view.container, "nw")).toEqual([30, 20]);
		expect(handlePos(view.container, "se")).toEqual([200, 150]);
	});

	it("elipse: se agarra la manija sobre el contorno, la esquina opuesta queda fija y el redimensionado se deshace", async () => {
		const view = await withShape("Elipse", [150, 150], [300, 250], [150, 200]);
		// Caja 150,150–300,250: la manija nw está en la diagonal de la curva, no en la esquina.
		const nw = [225 - 75 * Math.SQRT1_2, 200 - 50 * Math.SQRT1_2] as const;
		drag(canvasOf(view.container), [nw[0], nw[1]], [nw[0] - 20, nw[1] - 30]);
		// La manija queda donde se soltó; la esquina opuesta (300,250) no se mueve.
		const [x, y] = handlePos(view.container, "nw");
		expect(x).toBeCloseTo(nw[0] - 20 - 100, 1);
		expect(y).toBeCloseTo(nw[1] - 30 - 100, 1);
		// Con esa caja, el asa se está en la diagonal de la curva de su centro (esquina fija 300,250).
		const m = (1 + Math.SQRT1_2) / 2;
		const corner = [300 + (nw[0] - 20 - 300) / m, 250 + (nw[1] - 30 - 250) / m];
		const cx = (300 + corner[0]) / 2;
		const cy = (250 + corner[1]) / 2;
		const [sx, sy] = handlePos(view.container, "se");
		expect(sx).toBeCloseTo(cx + (300 - cx) * Math.SQRT1_2 - 100, 1);
		expect(sy).toBeCloseTo(cy + (250 - cy) * Math.SQRT1_2 - 100, 1);
		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		expect(handlePos(view.container, "nw")[0]).toBeCloseTo(nw[0] - 100, 1);
	});
});

describe("CaptureOverlay — activar una herramienta por clic o por teclado es lo mismo", () => {
	const TOOLS: [string, string][] = [
		["KeyH", "Seleccionar"],
		["KeyR", "Rectángulo"],
		["KeyO", "Elipse"],
		["KeyF", "Flecha"],
		["KeyL", "Lápiz"],
		["KeyT", "Texto"],
		["KeyM", "Mosaico"],
		["KeyB", "Borrador"],
	];
	const areaBtn = () =>
		screen.getByRole("button", { name: /^Área de captura/ });
	const snapshot = () => ({
		pressed: TOOLS.map(([, n]) =>
			screen.getByRole("button", { name: n }).getAttribute("aria-pressed"),
		),
		areaPointerEvents: areaBtn().style.pointerEvents,
		areaCursor: areaBtn().style.cursor,
	});

	it.each(TOOLS)(
		"%s deja el mismo estado que el clic en «%s»",
		async (code, name) => {
			const byClick = await mountWithSelection();
			fireEvent.click(screen.getByRole("button", { name }));
			const clicked = snapshot();
			byClick.unmount();

			await mountWithSelection();
			// Con el foco en un botón, como en uso real (el evento nace ahí, no en document).
			fireEvent.keyDown(screen.getByRole("button", { name }), {
				key: "x",
				code,
				altKey: true,
			});
			expect(snapshot()).toEqual(clicked);
		},
	);

	it("con Seleccionar activada por teclado, arrastrar una figura la mueve y no mueve el área", async () => {
		const view = await mountWithSelection();
		fireEvent.click(screen.getByRole("button", { name: "Rectángulo" }));
		drag(canvasOf(view.container), [150, 150], [300, 250]);
		fireEvent.keyDown(screen.getByRole("button", { name: "Rectángulo" }), {
			key: "h",
			code: "KeyH",
			altKey: true,
		});
		const before = areaBtn().style.left;
		fireEvent.pointerDown(areaBtn(), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 200,
		});
		fireEvent.pointerMove(areaBtn(), {
			pointerId: 1,
			clientX: 180,
			clientY: 230,
		});
		flushFrames();
		fireEvent.pointerUp(areaBtn(), {
			pointerId: 1,
			clientX: 180,
			clientY: 230,
		});
		expect(areaBtn().style.left).toBe(before);
		expect(undoBtn()).toBeEnabled();
		expect(screen.getByTestId("annotation-selection")).toBeInTheDocument();
	});
});

describe("CaptureOverlay — editar el contenido de un texto (doble clic y Enter)", () => {
	const toolBtn = (name: string) => screen.getByRole("button", { name });
	const areaBtn = () =>
		screen.getByRole("button", { name: /^Área de captura/ });
	const field = () =>
		screen.queryByLabelText("Editar el texto") as HTMLTextAreaElement | null;

	/** Escribe «hola» con la herramienta Texto en (150,150) y la deja en Seleccionar, sin elegir. */
	async function withText() {
		const view = await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		fireEvent.pointerDown(canvasOf(view.container), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 150,
		});
		const area = screen.getByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement;
		area.value = "hola";
		fireEvent.keyDown(area, { key: "Enter" });
		fireEvent.click(toolBtn("Seleccionar"));
		flushFrames();
		return view;
	}
	// El texto ocupa (150,150) → (207.6,178.8): (170,160) cae dentro.
	const INSIDE: [number, number] = [170, 160];

	const lastText = () => {
		const calls = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock
			.calls;
		return calls[calls.length - 1]?.[0];
	};

	it("doble clic sobre el texto (camino ratón) abre el campo con su contenido", async () => {
		await withText();
		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		expect(field()?.value).toBe("hola");
	});

	it("Enter con el texto elegido (camino teclado) abre el mismo campo y NO copia la captura", async () => {
		const view = await withText();
		drag(canvasOf(view.container), INSIDE, INSIDE);
		expect(field()).toBeNull();
		fireEvent.keyDown(document, { key: "Enter" });
		expect(field()?.value).toBe("hola");
		expect(copyCapture).not.toHaveBeenCalled();
	});

	it("Enter con una figura que no es texto sigue componiendo el PNG para copiar, como antes", async () => {
		// jsdom no codifica PNG: basta ver que la salida arranca (toBlob).
		const toBlob = vi
			.spyOn(HTMLCanvasElement.prototype, "toBlob")
			.mockImplementation(() => {});
		const view = await drawRectThenSelectTool();
		drag(canvasOf(view.container), [150, 200], [150, 200]);
		fireEvent.keyDown(document, { key: "Enter" });
		expect(field()).toBeNull();
		await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
	});

	it("Esc dentro de la edición confirma y NO cancela la captura; un clic fuera también confirma", async () => {
		const view = await withText();
		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		fireEvent.change(field() as HTMLTextAreaElement, {
			target: { value: "hola mundo" },
		});
		fireEvent.keyDown(field() as HTMLTextAreaElement, { key: "Escape" });
		expect(field()).toBeNull();
		expect(m.cancelCapture).not.toHaveBeenCalled();
		flushFrames();
		expect(lastText()).toBe("hola mundo");

		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		fireEvent.change(field() as HTMLTextAreaElement, {
			target: { value: "adiós" },
		});
		fireEvent.blur(field() as HTMLTextAreaElement);
		flushFrames();
		expect(lastText()).toBe("adiós");
		expect(canvasOf(view.container)).toBeInTheDocument();
	});

	it("cada edición es un paso: Ctrl+Z restituye el contenido y Ctrl+Shift+Z lo rehace", async () => {
		await withText();
		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		fireEvent.change(field() as HTMLTextAreaElement, {
			target: { value: "cambiado" },
		});
		fireEvent.keyDown(field() as HTMLTextAreaElement, {
			key: "Enter",
			ctrlKey: true,
		});
		flushFrames();
		expect(lastText()).toBe("cambiado");

		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		expect(lastText()).toBe("hola");
		fireEvent.keyDown(document, {
			key: "z",
			code: "KeyZ",
			ctrlKey: true,
			shiftKey: true,
		});
		flushFrames();
		expect(lastText()).toBe("cambiado");
	});

	it("las teclas de herramienta no cambian de herramienta mientras se teclea en la edición", async () => {
		await withText();
		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		const ta = field() as HTMLTextAreaElement;
		for (const [key, code] of [
			["h", "KeyH"],
			["v", "KeyV"],
			["r", "KeyR"],
			["t", "KeyT"],
			["?", "Slash"],
		]) {
			fireEvent.keyDown(ta, { key, code });
		}
		expect(toolBtn("Seleccionar")).toHaveAttribute("aria-pressed", "true");
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(field()).not.toBeNull();
	});

	it("Supr dentro de la edición borra letras, no la figura", async () => {
		await withText();
		fireEvent.doubleClick(areaBtn(), {
			clientX: INSIDE[0],
			clientY: INSIDE[1],
		});
		fireEvent.keyDown(field() as HTMLTextAreaElement, { key: "Delete" });
		flushFrames();
		expect(undoBtn()).toBeEnabled(); // el texto creado sigue siendo un paso
		expect(field()).not.toBeNull();
	});
});

describe("CaptureOverlay — tamaño de fuente del texto desde las opciones", () => {
	const toolBtn = (name: string) => screen.getByRole("button", { name });
	const size = (name: string) => screen.getByRole("radio", { name });
	const fillTexts = () =>
		(ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls;

	async function typeText(
		view: { container: HTMLElement },
		at: [number, number],
		value: string,
	) {
		fireEvent.pointerDown(canvasOf(view.container), {
			pointerId: 1,
			button: 0,
			clientX: at[0],
			clientY: at[1],
		});
		const area = screen.getByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement;
		area.value = value;
		fireEvent.keyDown(area, { key: "Enter" });
		flushFrames();
	}

	it("con la herramienta Texto, el tamaño elegido se aplica al siguiente texto que se escribe", async () => {
		const view = await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		expect(size("Texto mediano")).toBeChecked();
		fireEvent.click(size("Texto grande"));
		await typeText(view, [150, 150], "grande");
		expect(ctx.font).toContain("48px");
	});

	it("con un texto elegido, cambiar el tamaño lo cambia a ÉL, es un paso y se deshace y rehace", async () => {
		const view = await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		await typeText(view, [150, 150], "hola");
		fireEvent.click(toolBtn("Seleccionar"));
		drag(canvasOf(view.container), [170, 160], [170, 160]);
		expect(size("Texto mediano")).toBeChecked();

		fireEvent.click(size("Texto muy grande"));
		flushFrames();
		expect(ctx.font).toContain("96px");
		expect(size("Texto muy grande")).toBeChecked();
		expect(screen.getByLabelText("Tamaño de fuente actual")).toHaveTextContent(
			"96 px",
		);

		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		expect(ctx.font).toContain("24px");
		fireEvent.keyDown(document, {
			key: "z",
			code: "KeyZ",
			ctrlKey: true,
			shiftKey: true,
		});
		flushFrames();
		expect(ctx.font).toContain("96px");
		expect(fillTexts()[fillTexts().length - 1]?.[0]).toBe("hola");
	});
});

describe("CaptureOverlay completo — un texto elegido muestra y usa sus seis manijas", () => {
	const toolBtn = (name: string) => screen.getByRole("button", { name });
	const areaBtn = () =>
		screen.getByRole("button", { name: /^Área de captura/ });
	const fonts = () => String(ctx.font);
	const lines = () =>
		(ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
			(c) => c[0],
		);

	/** Escribe «hola» con Texto en (150,150), pasa a Seleccionar y elige el texto con un clic. */
	async function selectedText() {
		const view = await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		fireEvent.pointerDown(canvasOf(view.container), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 150,
		});
		const field = screen.getByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement;
		field.value = "hola mundo cruel";
		fireEvent.keyDown(field, { key: "Enter" });
		fireEvent.click(toolBtn("Seleccionar"));
		flushFrames();
		drag(canvasOf(view.container), [300, 160], [300, 160]);
		return view;
	}
	// Ancho automático: el de la línea (16 car. × 14,4 = 230,4): caja 150..380,4 × 150..178,8.

	it("el texto elegido muestra seis puntos visibles (4 esquinas y e/w) dentro del área", async () => {
		await selectedText();
		const root = screen.getByTestId("annotation-selection");
		expect(root.querySelectorAll("[data-handle-marker]")).toHaveLength(6);
		expect(
			[...root.querySelectorAll("[data-annotation-handle]")]
				.map((h) => h.getAttribute("data-annotation-handle"))
				.sort(),
		).toEqual(["e", "ne", "nw", "se", "sw", "w"]);
	});

	it("apuntar a cada manija da su cursor de redimensión sobre el marco del área real", async () => {
		await selectedText();
		const cursorAt = (x: number, y: number) => {
			fireEvent.pointerMove(areaBtn(), {
				pointerId: 1,
				clientX: x,
				clientY: y,
			});
			return areaBtn().style.cursor;
		};
		expect(cursorAt(150, 150)).toBe("nwse-resize");
		expect(cursorAt(380, 178)).toBe("nwse-resize");
		expect(cursorAt(380, 150)).toBe("nesw-resize");
		expect(cursorAt(380, 164.4)).toBe("ew-resize");
		expect(cursorAt(151, 164.4)).toBe("ew-resize");
		expect(cursorAt(300, 160)).toBe("grab");
	});

	it("arrastrar el lado e con el ratón real estrecha el recuadro, reparte más líneas y se deshace", async () => {
		await selectedText();
		flushFrames();
		const before = new Set(lines()).size;
		fireEvent.pointerDown(areaBtn(), {
			pointerId: 1,
			button: 0,
			clientX: 380,
			clientY: 164.4,
		});
		fireEvent.pointerMove(areaBtn(), {
			pointerId: 1,
			clientX: 250,
			clientY: 164.4,
		});
		flushFrames();
		fireEvent.pointerUp(areaBtn(), {
			pointerId: 1,
			clientX: 250,
			clientY: 164.4,
		});
		flushFrames();
		const last = lines().slice(-4);
		expect(last.length).toBeGreaterThan(1);
		expect(new Set(lines()).size).toBeGreaterThan(before);

		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		// Deshecho: vuelve a la caja del borde derecho (menos líneas que estrechado)
		expect(lines().slice(-2)).not.toEqual(last.slice(-2));
	});

	it("arrastrar una esquina con el ratón real escala la fuente (un paso)", async () => {
		await selectedText();
		expect(fonts()).toContain("24px");
		fireEvent.pointerDown(areaBtn(), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 150,
		});
		fireEvent.pointerMove(areaBtn(), {
			pointerId: 1,
			clientX: 100,
			clientY: 100,
		});
		flushFrames();
		fireEvent.pointerUp(areaBtn(), {
			pointerId: 1,
			clientX: 100,
			clientY: 100,
		});
		flushFrames();
		expect(fonts()).not.toContain("24px");
		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		expect(fonts()).toContain("24px");
	});
});

describe("CaptureOverlay completo — recuadro punteado y alineación del texto", () => {
	const toolBtn = (name: string) => screen.getByRole("button", { name });
	const areaBtn = () =>
		screen.getByRole("button", { name: /^Área de captura/ });
	const frame = () => document.querySelector<HTMLElement>("[data-text-frame]");

	async function typed(at: [number, number], value: string) {
		fireEvent.pointerDown(canvasOf(document.body), {
			pointerId: 1,
			button: 0,
			clientX: at[0],
			clientY: at[1],
		});
		const field = screen.getByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement;
		field.value = value;
		fireEvent.keyDown(field, { key: "Enter" });
		flushFrames();
	}

	async function selectedText() {
		await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		await typed([150, 150], "hola mundo");
		fireEvent.click(toolBtn("Seleccionar"));
		flushFrames();
		drag(canvasOf(document.body), [300, 160], [300, 160]);
	}

	it("elegir un texto muestra su recuadro punteado, con el ancho real del recuadro", async () => {
		await selectedText();
		expect(frame()).not.toBeNull();
		console.log(
			"CALLS",
			JSON.stringify(
				(ctx.fillText as unknown as { mock: { calls: unknown[] } }).mock.calls,
			),
			JSON.stringify(
				(
					ctx.measureText as unknown as { mock: { calls: unknown[] } }
				).mock.calls.slice(0, 5),
			),
		);
		// ancho automático: "hola mundo" = 10 car. × 14,4
		expect(Number.parseFloat(frame()?.style.width ?? "")).toBeCloseTo(144);
	});

	it("durante el arrastre del lado e el recuadro punteado sigue el ancho, y se queda al soltar", async () => {
		await selectedText();
		fireEvent.pointerDown(areaBtn(), {
			pointerId: 1,
			button: 0,
			clientX: 294,
			clientY: 164.4,
		});
		fireEvent.pointerMove(areaBtn(), {
			pointerId: 1,
			clientX: 250,
			clientY: 164.4,
		});
		flushFrames();
		const during = Number.parseFloat(frame()?.style.width ?? "");
		expect(during).toBeLessThan(144);
		expect(during).toBeGreaterThan(50);
		fireEvent.pointerUp(areaBtn(), {
			pointerId: 1,
			clientX: 250,
			clientY: 164.4,
		});
		flushFrames();
		expect(frame()).not.toBeNull();
		expect(Number.parseFloat(frame()?.style.width ?? "")).toBeCloseTo(
			during,
			0,
		);
	});

	it("deseleccionar o elegir otra figura quita el recuadro", async () => {
		await selectedText();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(frame()).toBeNull();
	});

	it("la alineación del texto elegido cambia con un paso de historial, se pinta y se deshace", async () => {
		await selectedText();
		const left = toolBtn("Alinear a la izquierda");
		expect(left).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(toolBtn("Alinear al centro"));
		flushFrames();
		expect(toolBtn("Alinear al centro")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(ctx.textAlign).toBe("center");
		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		expect(ctx.textAlign).toBe("left");
		expect(toolBtn("Alinear a la izquierda")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		fireEvent.keyDown(document, {
			key: "z",
			code: "KeyZ",
			ctrlKey: true,
			shiftKey: true,
		});
		flushFrames();
		expect(ctx.textAlign).toBe("center");
	});

	it("elegir la alineación con la herramienta Texto activa vale para el siguiente texto", async () => {
		await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		fireEvent.click(toolBtn("Alinear a la derecha"));
		await typed([150, 150], "hola");
		expect(ctx.textAlign).toBe("right");
	});

	it("elegir izquierda en un texto ya alineado a la izquierda no añade un paso", async () => {
		await selectedText();
		const before = undoBtn().hasAttribute("disabled");
		fireEvent.click(toolBtn("Alinear a la izquierda"));
		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		// el único paso deshecho es el de crear el texto: ya no se dibuja
		expect(before).toBe(false);
		expect(document.querySelector("[data-text-frame]")).toBeNull();
	});
});

describe("CaptureOverlay completo — escritura en vivo con la herramienta Texto", () => {
	const toolBtn = (name: string) => screen.getByRole("button", { name });
	const field = () =>
		screen.queryByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement | null;
	const frame = () => document.querySelector<HTMLElement>("[data-text-frame]");
	const frameWidth = () => Number.parseFloat(frame()?.style.width ?? "NaN");
	const frameHeight = () => Number.parseFloat(frame()?.style.height ?? "NaN");
	const type = (value: string) =>
		fireEvent.input(field() as HTMLTextAreaElement, { target: { value } });

	async function writing() {
		await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		fireEvent.pointerDown(canvasOf(document.body), {
			pointerId: 1,
			button: 0,
			clientX: 150,
			clientY: 150,
		});
		fireEvent.pointerUp(canvasOf(document.body), {
			pointerId: 1,
			clientX: 150,
			clientY: 150,
		});
		return field() as HTMLTextAreaElement;
	}

	it("carácter a carácter: el recuadro crece, deja de crecer en el borde derecho y baja de línea", async () => {
		await writing();
		let last = frameWidth();
		let grew = 0;
		let text = "";
		for (const ch of "esta frase es bastante larga para llegar al borde derecho del área") {
			text += ch;
			type(text);
			const w = frameWidth();
			expect(w).toBeGreaterThanOrEqual(last - 1e-9);
			if (w > last + 1e-9) grew++;
			expect(150 + w).toBeLessThanOrEqual(500 + 1e-9);
			last = w;
		}
		expect(grew).toBeGreaterThan(5);
		// llegó al tope (350 px) y desde ahí crece en alto
		expect(last).toBeGreaterThan(300);
		expect(frameHeight()).toBeGreaterThan(24 * 1.2 + 1);
	});

	it("las manijas se arrastran sin salir de la edición: el campo conserva el foco y lo escrito", async () => {
		const ta = await writing();
		type("hola");
		expect(document.activeElement).toBe(ta);
		// "hola" = 57,6 px: la manija e está en (207,6 ; 164,4)
		fireEvent.pointerDown(ta, {
			pointerId: 1,
			button: 0,
			clientX: 207.6,
			clientY: 164.4,
		});
		fireEvent.pointerMove(canvasOf(document.body), {
			pointerId: 1,
			clientX: 300,
			clientY: 164.4,
		});
		flushFrames();
		fireEvent.pointerUp(canvasOf(document.body), {
			pointerId: 1,
			clientX: 300,
			clientY: 164.4,
		});
		flushFrames();
		expect(field()).toBe(ta);
		expect(ta.value).toBe("hola");
		expect(document.activeElement).toBe(ta);
		expect(frameWidth()).toBeCloseTo(150, 0);
	});

	it("auto → fijo: tras arrastrar e/w el ancho ya no crece al seguir escribiendo", async () => {
		const ta = await writing();
		type("hola");
		fireEvent.pointerDown(ta, {
			pointerId: 1,
			button: 0,
			clientX: 207.6,
			clientY: 164.4,
		});
		fireEvent.pointerMove(canvasOf(document.body), {
			pointerId: 1,
			clientX: 260,
			clientY: 164.4,
		});
		flushFrames();
		fireEvent.pointerUp(canvasOf(document.body), {
			pointerId: 1,
			clientX: 260,
			clientY: 164.4,
		});
		flushFrames();
		const fixed = frameWidth();
		type("hola y bastantes palabras más");
		expect(frameWidth()).toBeCloseTo(fixed, 6);
		expect(frameHeight()).toBeGreaterThan(24 * 1.2 + 1); // baja de línea dentro del ancho fijo
	});

	it("los controles de ToolOptions no quitan el foco y actúan en vivo sobre el texto que se escribe", async () => {
		const ta = await writing();
		type("hola");
		for (const name of ["Alinear al centro"]) {
			const b = toolBtn(name);
			expect(fireEvent.mouseDown(b)).toBe(false);
			fireEvent.click(b);
		}
		fireEvent.click(screen.getByRole("radio", { name: "Texto grande" }));
		fireEvent.click(screen.getByRole("radio", { name: "Rojo" }));
		expect(field()).toBe(ta);
		expect(document.activeElement).toBe(ta);
		expect(ta.style.textAlign).toBe("center");
		expect(Number.parseFloat(ta.style.fontSize)).toBeGreaterThan(24);
	});

	it("confirmar con Ctrl+Enter deja el texto elegido en la herramienta Texto (marco, 6 manijas) y un solo paso de deshacer", async () => {
		const ta = await writing();
		type("hola");
		fireEvent.click(toolBtn("Alinear a la derecha"));
		fireEvent.click(screen.getByRole("radio", { name: "Texto grande" }));
		fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });
		flushFrames();
		expect(field()).toBeNull();
		expect(toolBtn("Texto")).toHaveAttribute("aria-pressed", "true");
		expect(frame()).not.toBeNull();
		expect(document.querySelectorAll("[data-annotation-handle]")).toHaveLength(
			6,
		);
		// crear + alinear + cambiar tamaño = UN paso
		fireEvent.keyDown(document, { key: "z", code: "KeyZ", ctrlKey: true });
		flushFrames();
		expect(frame()).toBeNull();
		expect(screen.getByRole("button", { name: /Deshacer/ })).toBeDisabled();
	});

	it("Esc con contenido confirma y deja elegido; un segundo Esc deselecciona; otro cancela la captura", async () => {
		const ta = await writing();
		type("hola");
		fireEvent.keyDown(ta, { key: "Escape" });
		flushFrames();
		expect(frame()).not.toBeNull();
		expect(m.cancelCapture).not.toHaveBeenCalled();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(frame()).toBeNull();
		expect(m.cancelCapture).not.toHaveBeenCalled();
		expect(toolBtn("Texto")).toHaveAttribute("aria-pressed", "true");
	});

	it("Alt+H con el texto elegido pasa a Seleccionar conservando la selección", async () => {
		const ta = await writing();
		type("hola");
		fireEvent.keyDown(ta, { key: "Escape" });
		flushFrames();
		fireEvent.keyDown(document, { key: "h", code: "KeyH", altKey: true });
		expect(toolBtn("Seleccionar")).toHaveAttribute("aria-pressed", "true");
		expect(frame()).not.toBeNull();
	});

	it("un clic en vacío con otro campo vacío abierto no deja campos huérfanos", async () => {
		await writing();
		fireEvent.pointerDown(canvasOf(document.body), {
			pointerId: 1,
			button: 0,
			clientX: 300,
			clientY: 300,
		});
		fireEvent.pointerUp(canvasOf(document.body), {
			pointerId: 1,
			clientX: 300,
			clientY: 300,
		});
		expect(document.querySelectorAll("textarea")).toHaveLength(1);
		expect(document.querySelectorAll("[data-text-frame]")).toHaveLength(1);
	});

	it("el recuadro y el texto exportado dejan un margen de 12 px con el borde derecho del área", async () => {
		await writing();
		type(
			"una frase bastante larga que llega hasta el borde derecho del área de captura y sigue",
		);
		const right =
			Number.parseFloat(frame()?.style.left ?? "NaN") + frameWidth();
		// el área mide 400 px (100..500): el recuadro termina a 400 − 12 como mucho
		expect(right).toBeLessThanOrEqual(400 - TEXT_RIGHT_MARGIN + 1e-9);
		expect(right).toBeGreaterThan(400 - TEXT_RIGHT_MARGIN - 40);
		fireEvent.keyDown(field() as HTMLTextAreaElement, {
			key: "Enter",
			ctrlKey: true,
		});
		flushFrames();
		// PNG: ninguna línea pasa de 500 − 12 (px de imagen)
		const calls = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(calls.length).toBeGreaterThan(1);
		for (const [line, x] of calls.slice(-calls.length)) {
			expect(x + (line as string).length * 24 * 0.6).toBeLessThanOrEqual(
				500 - TEXT_RIGHT_MARGIN + 1e-9,
			);
		}
	});

	it("crear junto al borde derecho también respeta el margen", async () => {
		await mountWithSelection();
		fireEvent.click(toolBtn("Texto"));
		fireEvent.pointerDown(canvasOf(document.body), {
			pointerId: 1,
			button: 0,
			clientX: 495,
			clientY: 150,
		});
		type("palabra palabra palabra");
		const right =
			Number.parseFloat(frame()?.style.left ?? "NaN") + frameWidth();
		expect(right).toBeLessThanOrEqual(400 - TEXT_RIGHT_MARGIN + 1e-9);
	});
});
