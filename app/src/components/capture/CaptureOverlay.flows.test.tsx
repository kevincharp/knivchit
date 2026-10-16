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
 * PAUTA: «flujo completo del usuario sin cambiar de herramienta», para cada
 * herramienta de dibujo, desde el overlay completo. Origen: tres veces un flujo
 * real del texto (escribir largo, elegir lo recién creado, alinear mientras se
 * escribe) escapó a los tests porque cada uno probaba una pieza o cambiaba de
 * herramienta a mitad. Aquí el usuario se queda en la herramienta: activa,
 * dibuja, cambia color/grosor de ToolOptions, dibuja otra vez, deshace y rehace.
 */

// Selección en pantalla (scale 1): x 100..500, y 100..400.
const SEL = { left: 100, top: 100, width: 400, height: 300 };

let ctx: CanvasRenderingContext2D;
let rafQueue: FrameRequestCallback[];
let events: { k: string; v?: unknown }[] = [];

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

	events = [];
	const store: Record<string, unknown> = {
		save: vi.fn(() => events.push({ k: "save" })),
		clearRect: vi.fn(() => events.push({ k: "clear" })),
	};
	ctx = new Proxy(store, {
		get: (t, k: string) => {
			if (!(k in t)) t[k] = vi.fn();
			return t[k];
		},
		set: (t, k: string, v) => {
			if (k === "strokeStyle" || k === "lineWidth") events.push({ k, v });
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

type Mode = "clic" | "Alt+letra";
const ALT: Record<string, string> = {
	Texto: "KeyT",
	Rectángulo: "KeyR",
	Elipse: "KeyO",
	Flecha: "KeyF",
	Lápiz: "KeyL",
	Mosaico: "KeyM",
};
function activate(name: string, mode: Mode) {
	if (mode === "clic") {
		fireEvent.click(screen.getByRole("button", { name }));
		return;
	}
	const code = ALT[name];
	fireEvent.keyDown(document.activeElement ?? document.body, {
		key: code.slice(3).toLowerCase(),
		code,
		altKey: true,
	});
}
const canvas = (c: HTMLElement) =>
	c.querySelector("canvas") as HTMLCanvasElement;

function stroke(c: HTMLElement, points: [number, number][]) {
	const el = canvas(c);
	const [first, ...rest] = points;
	fireEvent.pointerDown(el, {
		pointerId: 1,
		button: 0,
		clientX: first[0],
		clientY: first[1],
	});
	for (const p of rest) {
		fireEvent.pointerMove(el, { pointerId: 1, clientX: p[0], clientY: p[1] });
	}
	flushFrames();
	const last = points[points.length - 1];
	fireEvent.pointerUp(el, { pointerId: 1, clientX: last[0], clientY: last[1] });
	flushFrames();
}

/** Figuras del último redibujado completo, con el color y el grosor con que se pintaron. */
function figuras(): { color: unknown; width: unknown }[] {
	flushFrames();
	const lastClear = events.map((e) => e.k).lastIndexOf("clear");
	const out: { color: unknown; width: unknown }[] = [];
	// drawAnnotation hace `save()` y enseguida asigna strokeStyle: una figura por par
	// (el mosaico hace además sus propios save/restore, y otros dibujos no empiezan así).
	const tail = events.slice(lastClear + 1);
	tail.forEach((e, i) => {
		if (e.k === "strokeStyle" && tail[i - 1]?.k === "save") {
			out.push({ color: e.v, width: undefined });
		} else if (e.k === "lineWidth" && out.length) {
			out[out.length - 1].width = e.v;
		}
	});
	return out;
}

const pressed = () =>
	screen
		.getAllByRole("button")
		.filter((b) => b.getAttribute("aria-pressed") === "true")
		.map((b) => b.getAttribute("aria-label") ?? b.textContent);
const undo = () =>
	fireEvent.click(screen.getByRole("button", { name: /Deshacer/i }));
const redo = () =>
	fireEvent.click(screen.getByRole("button", { name: /Rehacer/i }));
const undoButton = () =>
	screen.getByRole("button", { name: /Deshacer/i }) as HTMLButtonElement;

interface Herramienta {
	nombre: string;
	/** Dibuja la figura A y la B (en sitios distintos del área). */
	a: [number, number][];
	b: [number, number][];
	color: boolean;
	grosor: boolean;
}
const HERRAMIENTAS: Herramienta[] = [
	{
		nombre: "Rectángulo",
		a: [
			[150, 150],
			[250, 220],
		],
		b: [
			[300, 250],
			[420, 350],
		],
		color: true,
		grosor: true,
	},
	{
		nombre: "Elipse",
		a: [
			[150, 150],
			[250, 220],
		],
		b: [
			[300, 250],
			[420, 350],
		],
		color: true,
		grosor: true,
	},
	{
		nombre: "Flecha",
		a: [
			[150, 150],
			[250, 220],
		],
		b: [
			[300, 250],
			[420, 350],
		],
		color: true,
		grosor: true,
	},
	{
		nombre: "Lápiz",
		a: [
			[150, 150],
			[180, 190],
			[210, 160],
			[240, 200],
		],
		b: [
			[300, 300],
			[330, 340],
			[360, 310],
			[390, 350],
		],
		color: true,
		grosor: true,
	},
	{
		nombre: "Mosaico",
		a: [
			[150, 150],
			[180, 190],
			[210, 160],
			[240, 200],
		],
		b: [
			[300, 300],
			[330, 340],
			[360, 310],
			[390, 350],
		],
		color: false,
		grosor: true,
	},
];

describe("flujo completo sin cambiar de herramienta: dibujar, ajustar opciones, dibujar, deshacer y rehacer", () => {
	it("cubre todas las herramientas de dibujo salvo el texto (que tiene su propio flujo)", () => {
		expect(HERRAMIENTAS.map((h) => h.nombre).sort()).toEqual(
			["Elipse", "Flecha", "Lápiz", "Mosaico", "Rectángulo"].sort(),
		);
	});

	for (const modo of ["clic", "Alt+letra"] as const) {
		it.each(HERRAMIENTAS)(`$nombre (activada con ${modo})`, async (h) => {
			const { container } = await mountWithSelection();
			activate(h.nombre, modo);
			expect(pressed()).toEqual([h.nombre]);

			stroke(container, h.a);
			expect(figuras()).toHaveLength(1);
			const primera = figuras()[0];

			if (h.color) fireEvent.click(screen.getByRole("radio", { name: "Azul" }));
			if (h.grosor)
				fireEvent.click(screen.getByRole("radio", { name: "Grueso" }));
			// ajustar opciones no cambia de herramienta ni toca lo ya dibujado
			expect(pressed()).toEqual([h.nombre]);
			expect(figuras()[0]).toEqual(primera);

			stroke(container, h.b);
			const dos = figuras();
			expect(dos, "dos figuras").toHaveLength(2);
			expect(dos[0]).toEqual(primera);
			// el color real no se puede leer en jsdom (los tokens CSS no se resuelven): se comprueba la opción elegida
			if (h.color)
				expect(screen.getByRole("radio", { name: "Azul" })).toHaveAttribute(
					"aria-checked",
					"true",
				);
			if (h.grosor) expect(dos[1].width).not.toEqual(dos[0].width);
			expect(pressed()).toEqual([h.nombre]);

			undo();
			expect(figuras()).toHaveLength(1);
			expect(figuras()[0]).toEqual(primera);
			redo();
			expect(figuras()).toHaveLength(2);
			undo();
			flushFrames(); // un clic humano tarda más de un frame; el caso de dos en el mismo frame va aparte
			undo();
			expect(figuras()).toHaveLength(0);
			expect(undoButton().disabled).toBe(true);
			expect(pressed()).toEqual([h.nombre]);
		});
	}
});

/**
 * Flujo del texto SIN cambiar de herramienta (petición del usuario tras probar
 * 3da0b82). Skip hasta que frontend lo publique; al hacerlo, `flujoTexto =
 * it.skip` → `it`.
 *   1. Con Texto activo, el recuadro punteado y las manijas se ven mientras se escribe.
 *   2. Alineación, tamaño y color de ToolOptions actúan EN VIVO sobre el texto que
 *      se escribe: pulsarlos no quita el foco ni confirma.
 *   3. Al confirmar, el texto queda elegido en la herramienta Texto, con manijas,
 *      hasta clic en vacío / Esc / cambio de herramienta; un clic sobre un texto
 *      existente lo edita (no crea otro); nunca quedan textos vacíos huérfanos.
 */
const flujoTexto = it;

describe("texto: escribir → alinear → redimensionar → confirmar sin cambiar de herramienta", () => {
	const campo = () =>
		screen.queryByLabelText(
			"Texto de la anotación",
		) as HTMLTextAreaElement | null;
	const recuadros = () =>
		document.querySelectorAll(
			'[data-testid="annotation-selection"] [data-text-frame]',
		);
	const manijas = () => document.querySelectorAll("[data-annotation-handle]");
	const boton = (n: string) => screen.getByRole("button", { name: n });

	async function escribiendo(contenido = "hola mundo") {
		const view = await mountWithSelection();
		activate("Texto", "clic");
		fireEvent.pointerDown(canvas(view.container), {
			pointerId: 1,
			button: 0,
			clientX: 120,
			clientY: 150,
		});
		fireEvent.pointerUp(canvas(view.container), {
			pointerId: 1,
			clientX: 120,
			clientY: 150,
		});
		const c = campo() as HTMLTextAreaElement;
		c.value = contenido;
		fireEvent.input(c);
		return { ...view, campo: c };
	}
	const confirmar = (c: HTMLTextAreaElement) => {
		fireEvent.keyDown(c, { key: "Enter", ctrlKey: true });
		flushFrames();
	};

	flujoTexto(
		"mientras se escribe se ven el recuadro punteado y las manijas",
		async () => {
			await escribiendo();
			expect(recuadros()).toHaveLength(1);
			expect(manijas()).toHaveLength(6);
		},
	);

	flujoTexto(
		"pulsar un botón de ToolOptions no quita el foco ni confirma",
		async () => {
			const { campo: c } = await escribiendo();
			for (const n of ["Alinear al centro", "Texto grande"]) {
				const b = screen.getByRole(
					n.startsWith("Alinear") ? "button" : "radio",
					{ name: n },
				);
				// el botón no roba el foco: el mousedown se cancela
				expect(fireEvent.mouseDown(b), `${n} roba el foco`).toBe(false);
				fireEvent.click(b);
				expect(campo(), `${n} cerró el campo`).toBe(c);
			}
		},
	);

	flujoTexto(
		"alineación, tamaño y color actúan en vivo sobre el mismo texto",
		async () => {
			const { campo: c } = await escribiendo();
			fireEvent.click(boton("Alinear al centro"));
			expect(campo()?.style.textAlign).toBe("center");
			fireEvent.click(screen.getByRole("radio", { name: "Texto grande" }));
			expect(Number.parseFloat(campo()?.style.fontSize ?? "0")).toBeGreaterThan(
				24,
			);
			fireEvent.click(screen.getByRole("radio", { name: "Azul" }));
			confirmar(c);
			// un único texto, con lo elegido
			expect(paintedLinesText()).toEqual(["hola mundo"]);
			expect(String(ctx.textAlign)).toBe("center");
		},
	);

	flujoTexto(
		"crear + alinear + escalar es coherente con deshacer: se deshace paso a paso",
		async () => {
			const { campo: c } = await escribiendo();
			fireEvent.click(boton("Alinear al centro"));
			confirmar(c);
			fireEvent.click(screen.getByRole("button", { name: /Deshacer/i }));
			flushFrames();
			// lo creado con alineación desaparece entero de una vez, sin dejar un texto a medias
			expect(paintedLinesText()).toEqual([]);
			fireEvent.click(screen.getByRole("button", { name: /Rehacer/i }));
			flushFrames();
			expect(paintedLinesText()).toEqual(["hola mundo"]);
			expect(String(ctx.textAlign)).toBe("center");
		},
	);

	flujoTexto(
		"al confirmar sigue en la herramienta Texto y el texto queda elegido, con recuadro y 6 manijas",
		async () => {
			const { campo: c } = await escribiendo();
			confirmar(c);
			expect(campo()).toBeNull();
			expect(
				screen
					.getAllByRole("button")
					.filter((b) => b.getAttribute("aria-pressed") === "true")
					.map((b) => b.getAttribute("aria-label") ?? b.textContent),
			).toContain("Texto");
			expect(recuadros()).toHaveLength(1);
			expect(manijas()).toHaveLength(6);
		},
	);

	flujoTexto(
		"Esc o clic en el vacío deselecciona; la herramienta sigue siendo Texto",
		async () => {
			const { campo: c, container } = await escribiendo();
			confirmar(c);
			fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
			flushFrames();
			expect(recuadros()).toHaveLength(0);
			expect(screen.getByRole("button", { name: "Texto" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			// vuelve a elegirlo con un clic sobre él y se deselecciona con otro en el vacío sin crear campos vacíos
			fireEvent.pointerDown(canvas(container), {
				pointerId: 1,
				button: 0,
				clientX: 130,
				clientY: 160,
			});
			fireEvent.pointerUp(canvas(container), {
				pointerId: 1,
				clientX: 130,
				clientY: 160,
			});
			flushFrames();
			// Un clic sobre un texto existente lo edita («Editar el texto»), no abre uno nuevo.
			expect(screen.queryByLabelText("Editar el texto")).not.toBeNull();
			expect(campo()).toBeNull();
		},
	);

	flujoTexto(
		"clic sobre un texto existente con la herramienta Texto lo edita y no crea otro",
		async () => {
			const { campo: c, container } = await escribiendo("uno");
			confirmar(c);
			fireEvent.pointerDown(canvas(container), {
				pointerId: 1,
				button: 0,
				clientX: 125,
				clientY: 160,
			});
			fireEvent.pointerUp(canvas(container), {
				pointerId: 1,
				clientX: 125,
				clientY: 160,
			});
			const editor = screen.getByLabelText(
				"Editar el texto",
			) as HTMLTextAreaElement;
			expect(editor.value).toBe("uno");
			confirmar(editor);
			expect(paintedLinesText()).toEqual(["uno"]);
		},
	);

	flujoTexto(
		"un clic que abre un campo y se abandona sin escribir no deja un texto vacío",
		async () => {
			const { container } = await mountWithSelection();
			activate("Texto", "clic");
			fireEvent.pointerDown(canvas(container), {
				pointerId: 1,
				button: 0,
				clientX: 300,
				clientY: 300,
			});
			fireEvent.pointerUp(canvas(container), {
				pointerId: 1,
				clientX: 300,
				clientY: 300,
			});
			const c = campo() as HTMLTextAreaElement;
			fireEvent.blur(c);
			flushFrames();
			expect(campo()).toBeNull();
			expect(recuadros()).toHaveLength(0);
			expect(manijas()).toHaveLength(0);
			expect(undoButton().disabled).toBe(true);
		},
	);
});

function paintedLinesText(): string[] {
	flushFrames();
	const orders = (ctx.clearRect as unknown as ReturnType<typeof vi.fn>).mock
		.invocationCallOrder;
	const last = orders.length ? Math.max(...orders) : 0;
	const f = (ctx.fillText as unknown as ReturnType<typeof vi.fn>).mock;
	return f.calls
		.map((c, i) => ({ t: String(c[0]), o: f.invocationCallOrder[i] }))
		.filter((l) => l.o > last)
		.map((l) => l.t);
}
