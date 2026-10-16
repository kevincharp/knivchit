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
 * Un mismo gesto del usuario, dos caminos: elegir una herramienta con el CLIC
 * en la toolbar o con el TECLADO (Alt+letra, letra sola, V/H) debe dejar el
 * mismo estado y el mismo comportamiento del siguiente arrastre. Lección de la
 * prueba manual de 6b8e370: los tests anteriores solo probaban el camino del
 * clic y el bug estaba en el del teclado (con Alt+H, arrastrar una figura movía
 * el recuadro de la captura).
 *
 * Los tests marcados `bug(...)` reproducen un defecto abierto (rojo confirmado);
 * al publicar el arreglo, cambiar `bug = it.skip` por `bug = it`.
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

const TOOLS = [
	{ name: "Seleccionar", code: "KeyH", plain: ["KeyH", "KeyV"] },
	{ name: "Rectángulo", code: "KeyR", plain: ["KeyR"] },
	{ name: "Elipse", code: "KeyO", plain: ["KeyO"] },
	{ name: "Flecha", code: "KeyF", plain: ["KeyF"] },
	{ name: "Lápiz", code: "KeyL", plain: ["KeyL"] },
	{ name: "Texto", code: "KeyT", plain: ["KeyT"] },
	{ name: "Mosaico", code: "KeyM", plain: ["KeyM"] },
	{ name: "Borrador", code: "KeyB", plain: ["KeyB"] },
] as const;

type Mode = "clic" | "Alt+letra" | "letra" | "V";

function activate(name: string, code: string, mode: Mode) {
	if (mode === "clic") {
		fireEvent.click(screen.getByRole("button", { name }));
		return;
	}
	const key = mode === "V" ? "KeyV" : code;
	// Como el navegador: el evento nace en el elemento con foco y sube al documento.
	fireEvent.keyDown(document.activeElement ?? document.body, {
		key: key.slice(3).toLowerCase(),
		code: key,
		altKey: mode === "Alt+letra",
	});
}

const pressedTool = () =>
	screen
		.getAllByRole("button")
		.filter((b) => b.getAttribute("aria-pressed") === "true")
		.map((b) => b.getAttribute("aria-label") ?? b.textContent);

/** Rectángulo (150,150)-(300,250) hecho SIEMPRE por clic: es el punto de partida común. */
async function withRect() {
	const view = await mountWithSelection();
	fireEvent.click(screen.getByRole("button", { name: "Rectángulo" }));
	dragReal(view.container, [150, 150], [300, 250]);
	fireEvent.click(screen.getByRole("button", { name: "Rectángulo" }));
	return view;
}

/** Estado observable tras activar la herramienta y hacer el mismo arrastre sobre el borde del rectángulo. */
async function scenario(
	tool: (typeof TOOLS)[number],
	mode: Mode,
	focusFrame = false,
) {
	const view = await withRect();
	// Tras mover el área con el ratón el foco queda en el marco (SelectionFrame lo pide a mano).
	if (focusFrame) areaFrame().focus();
	activate(tool.name, tool.code, mode);
	const canvas = canvasOf(view.container);
	const pressed = pressedTool();
	// Cursor al pasar por el borde del rectángulo, antes de arrastrar.
	const over = topmostAt(view.container, 150, 200);
	fireEvent.pointerMove(over, { pointerId: 1, clientX: 150, clientY: 200 });
	flushFrames();
	const cursor = (over as HTMLElement).style.cursor || canvas.style.cursor;
	const area = areaPos();
	const label = areaLabel();

	dragReal(view.container, [150, 175], [210, 205]);

	return {
		pressed,
		cursor,
		areaMoved: areaPos().join() !== area.join() || areaLabel() !== label,
		undoEnabled: !(
			screen.getByRole("button", { name: /Deshacer/i }) as HTMLButtonElement
		).disabled,
		hasSelectionUi: screen.queryByTestId("annotation-selection") !== null,
		textarea: screen.queryByLabelText("Texto de la anotación") !== null,
	};
}

describe("herramientas — clic y teclado dan el mismo estado y el mismo siguiente arrastre", () => {
	for (const tool of TOOLS) {
		const modes: Mode[] = ["Alt+letra", "letra"];
		if (tool.name === "Seleccionar") modes.push("V");
		for (const mode of modes) {
			it(`${tool.name}: ${mode} equivale al clic`, async () => {
				const porClic = await scenario(tool, "clic");
				cleanup();
				const porTeclado = await scenario(tool, mode);
				expect(porTeclado).toEqual(porClic);
			});

			it(`${tool.name}: ${mode} con el foco en el marco del área equivale al clic`, async () => {
				const porClic = await scenario(tool, "clic", true);
				cleanup();
				const porTeclado = await scenario(tool, mode, true);
				expect(porTeclado).toEqual(porClic);
			});
		}
	}

	it("Seleccionar por teclado: arrastrar una figura la mueve y NO mueve el área", async () => {
		const view = await withRect();
		activate("Seleccionar", "KeyH", "Alt+letra");
		const area = areaPos();
		const label = areaLabel();
		// Primer clic elige la figura; el segundo gesto la arrastra.
		dragReal(view.container, [150, 175], [150, 175]);

		dragReal(view.container, [150, 175], [210, 205]);

		expect(areaPos()).toEqual(area);
		expect(areaLabel()).toBe(label);
		// La figura (no el área) se movió (+60,+30): se lee del dibujo, no de la UI de selección.
		flushFrames();
		const calls = (ctx.strokeRect as unknown as ReturnType<typeof vi.fn>).mock
			.calls;
		expect(calls[calls.length - 1]?.slice(0, 2)).toEqual([210, 180]);
	});

	bug(
		"mantener pulsado Alt+H (autorepetición del teclado) no apaga ni alterna la herramienta",
		async () => {
			await withRect();
			const init = { key: "h", code: "KeyH", altKey: true };
			fireEvent.keyDown(document, init);
			for (let i = 0; i < 3; i++) {
				fireEvent.keyDown(document, { ...init, repeat: true });
			}
			expect(
				screen.getByRole("button", { name: "Seleccionar" }),
			).toHaveAttribute("aria-pressed", "true");
		},
	);
});
