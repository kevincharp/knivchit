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

import { TEXT_RIGHT_MARGIN } from "./annotations";
import { CaptureOverlay } from "./CaptureOverlay";

/**
 * Integración a NIVEL CaptureOverlay (overlay completo, no AnnotationCanvas
 * aislado) del ciclo «crear → seleccionar → editar» para toda figura. Origen:
 * el texto largo se creaba como UNA línea infinita que rebasaba el borde de la
 * selección (B) y el texto elegido no ofrecía sus manijas (A); los tests de
 * L8 montaban AnnotationCanvas con un texto ya hecho y corto, nunca crearlo
 * desde el overlay con contenido largo ni seleccionar lo recién creado.
 */

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

// ---- ciclo completo, desde el overlay ----

type Mode = "clic" | "Alt+letra";
const ALT: Record<string, string> = {
	Seleccionar: "KeyH",
	Rectángulo: "KeyR",
	Elipse: "KeyO",
	Flecha: "KeyF",
	Lápiz: "KeyL",
	Texto: "KeyT",
	Mosaico: "KeyM",
};

function activate(name: string, mode: Mode = "clic") {
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
const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;

/** Líneas pintadas en el último redibujado completo (tras el último clearRect). */
function paintedLines(): { text: string; x: number; y: number }[] {
	flushFrames();
	const orders = fn(ctx.clearRect).mock.invocationCallOrder;
	const lastClear = orders.length ? Math.max(...orders) : 0;
	const f = fn(ctx.fillText).mock;
	return f.calls
		.map((c, i) => ({
			text: String(c[0]),
			x: Number(c[1]),
			y: Number(c[2]),
			order: f.invocationCallOrder[i],
		}))
		.filter((l) => l.order > lastClear);
}

/** Escribe `content` en un texto nuevo en (at) con la herramienta Texto y lo confirma con Enter. */
function createText(
	container: HTMLElement,
	content: string,
	at: [number, number],
	mode: Mode,
) {
	activate("Texto", mode);
	fireEvent.pointerDown(canvas(container), {
		pointerId: 1,
		button: 0,
		clientX: at[0],
		clientY: at[1],
	});
	fireEvent.pointerUp(canvas(container), {
		pointerId: 1,
		clientX: at[0],
		clientY: at[1],
	});
	const field = screen.getByLabelText(
		"Texto de la anotación",
	) as HTMLTextAreaElement;
	field.value = content;
	fireEvent.keyDown(field, { key: "Enter" });
	flushFrames();
}

function stroke(points: [number, number][]) {
	const el = canvas(document.body);
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

const LARGO =
	"Este es un texto bastante largo que el usuario escribe de corrido sin saltos de línea y que debe repartirse solo al llegar al borde de la selección de captura";

describe("texto largo creado desde el overlay: ajuste automático al borde de la selección", () => {
	it.each(["clic", "Alt+letra"] as const)(
		"crear con la herramienta activada por %s: varias líneas y ninguna pasa del borde derecho",
		async (mode) => {
			const { container } = await mountWithSelection();
			createText(container, LARGO, [120, 150], mode);
			const lines = paintedLines();
			expect(lines.length, "debe repartirse en varias líneas").toBeGreaterThan(
				1,
			);
			// el modelo estima 0,6·fuente por carácter; la selección acaba en x=500
			const size = 24;
			for (const l of lines) {
				const right = l.x + l.text.length * size * 0.6;
				expect(right, `«${l.text}» rebasa la selección`).toBeLessThanOrEqual(
					500 + 1,
				);
			}
			// y no se pierde ni se añade texto al repartir
			expect(
				lines
					.map((l) => l.text)
					.join(" ")
					.replace(/\s+/g, " ")
					.trim(),
			).toBe(LARGO);
		},
	);

	it("un texto corto sigue en una sola línea", async () => {
		const { container } = await mountWithSelection();
		createText(container, "Hola", [120, 150], "clic");
		expect(paintedLines().map((l) => l.text)).toEqual(["Hola"]);
	});

	it("cerca del borde derecho el texto se reparte igualmente (el ancho es hasta el borde, no un valor fijo)", async () => {
		const { container } = await mountWithSelection();
		createText(container, "palabra palabra palabra", [380, 150], "clic");
		const lines = paintedLines();
		expect(lines.length).toBeGreaterThan(1);
		for (const l of lines) {
			expect(l.x + l.text.length * 24 * 0.6).toBeLessThanOrEqual(
				500 - TEXT_RIGHT_MARGIN + 1,
			);
		}
	});
});

/**
 * Ajuste con medidas REALES (reporte del candidato e406021: hueco de ~120 px
 * entre la última palabra y el borde por estimar 0,6 em por carácter). La
 * fuente real mide menos (Inter ≈ 0,5 em de media), así que el canvas se
 * simula con `measureText` a 0,5 em por carácter y se exige que cada línea
 * (salvo la última) quede llena: con palabras cortas, ≥ 90 % del ancho.
 * Hasta que el reparto use `measureText`, este test no puede pasar.
 */
const medidasReales = it;

describe("el reparto de líneas usa las medidas reales de la fuente", () => {
	medidasReales(
		"cada línea (salvo la última) ocupa ≥ 90 % del ancho disponible y cabe en él",
		async () => {
			const EM = 0.5;
			fn(ctx.measureText).mockImplementation((t: string) => ({
				width: t.length * 24 * EM,
			}));
			const { container } = await mountWithSelection();
			const corto = Array.from(
				{ length: 70 },
				(_, i) => ["sol", "mar", "luz", "pan"][i % 4],
			).join(" ");
			createText(container, corto, [120, 150], "clic");
			const lines = paintedLines();
			expect(lines.length).toBeGreaterThan(2);
			const disponible = 500 - TEXT_RIGHT_MARGIN - 120;
			const w = (t: string) => t.length * 24 * EM;
			lines.slice(0, -1).forEach((l, i) => {
				expect(w(l.text), `línea ${i} no cabe`).toBeLessThanOrEqual(disponible);
				// llena: la holgura es menor que la palabra siguiente (≤ 3 letras) y su espacio
				expect(
					disponible - w(l.text),
					`línea ${i} «${l.text}» vacía`,
				).toBeLessThan(w("xxxx"));
			});
		},
	);
});

describe("texto recién creado y elegido: ofrece sus 6 manijas y se pueden arrastrar", () => {
	const IDS = ["e", "ne", "nw", "se", "sw", "w"];

	async function conTextoElegido(mode: Mode) {
		const view = await mountWithSelection();
		createText(view.container, LARGO, [120, 150], mode);
		activate("Seleccionar", mode);
		// el primer clic elige la figura
		dragReal(view.container, [140, 160], [140, 160]);
		return view;
	}
	const handleIds = (c: HTMLElement) =>
		[...c.querySelectorAll<HTMLElement>("[data-annotation-handle]")]
			.map((h) => h.dataset.annotationHandle as string)
			.sort();

	it.each(["clic", "Alt+letra"] as const)(
		"seleccionado con Seleccionar activado por %s: las 6 manijas están presentes",
		async (mode) => {
			const { container } = await conTextoElegido(mode);
			expect(handleIds(container)).toEqual(IDS);
		},
	);

	it("el cursor sobre cada manija es de redimensión y arrastrar la `e` reajusta las líneas", async () => {
		const { container } = await conTextoElegido("clic");
		const before = paintedLines().length;
		for (const id of IDS) {
			const h = container.querySelector<HTMLElement>(
				`[data-annotation-handle="${id}"]`,
			);
			expect(h, id).not.toBeNull();
			const x = 100 + Number.parseFloat(h?.style.left ?? "0");
			const y = 100 + Number.parseFloat(h?.style.top ?? "0");
			fireEvent.pointerMove(canvas(container), {
				pointerId: 1,
				clientX: x,
				clientY: y,
			});
			flushFrames();
			expect(canvas(container).style.cursor, id).toMatch(/resize/);
		}
		const e = container.querySelector<HTMLElement>(
			'[data-annotation-handle="e"]',
		);
		const ex = 100 + Number.parseFloat(e?.style.left ?? "0");
		const ey = 100 + Number.parseFloat(e?.style.top ?? "0");
		dragReal(container, [ex, ey], [ex - 150, ey]);
		const after = paintedLines();
		expect(after.length, "más estrecho: más líneas").toBeGreaterThan(before);
	});
});

describe("toda figura recién creada y elegida muestra sus manijas (parametrizado por figura)", () => {
	type Caso = {
		nombre: string;
		tool: keyof typeof ALT;
		crear: (c: HTMLElement) => void;
		cuerpo: [number, number];
		manijas: string[];
	};
	const CASOS: Caso[] = [
		{
			nombre: "rect",
			tool: "Rectángulo",
			crear: () =>
				stroke([
					[150, 150],
					[300, 250],
				]),
			cuerpo: [150, 200],
			manijas: ["e", "n", "ne", "nw", "s", "se", "sw", "w"],
		},
		{
			nombre: "ellipse",
			tool: "Elipse",
			crear: () =>
				stroke([
					[150, 150],
					[300, 250],
				]),
			cuerpo: [150, 200],
			manijas: ["e", "n", "ne", "nw", "s", "se", "sw", "w"],
		},
		{
			nombre: "arrow",
			tool: "Flecha",
			crear: () =>
				stroke([
					[150, 150],
					[300, 250],
				]),
			cuerpo: [225, 200],
			manijas: ["end", "start"],
		},
		{
			nombre: "pen",
			tool: "Lápiz",
			crear: () =>
				stroke([
					[150, 150],
					[180, 190],
					[210, 160],
					[240, 200],
					[270, 170],
				]),
			cuerpo: [180, 190],
			manijas: [],
		},
		{
			nombre: "mosaic",
			tool: "Mosaico",
			crear: () =>
				stroke([
					[150, 300],
					[180, 330],
					[210, 300],
					[240, 330],
					[270, 300],
				]),
			cuerpo: [180, 330],
			manijas: [],
		},
		{
			nombre: "text",
			tool: "Texto",
			crear: (c) => createText(c, LARGO, [120, 150], "clic"),
			cuerpo: [140, 160],
			manijas: ["e", "ne", "nw", "se", "sw", "w"],
		},
	];

	it("cubre las seis figuras", () => {
		expect(CASOS.map((c) => c.nombre).sort()).toEqual(
			["arrow", "ellipse", "mosaic", "pen", "rect", "text"].sort(),
		);
	});

	// Una manija fuera del área queda recortada (el contenedor es overflow-hidden):
	// ni se ve ni se agarra. Era la consecuencia visible de B en el texto largo.
	const dentro = (c: HTMLElement) =>
		[...c.querySelectorAll<HTMLElement>("[data-annotation-handle]")].every(
			(h) => {
				const x = Number.parseFloat(h.style.left);
				const y = Number.parseFloat(h.style.top);
				return x >= 0 && x <= SEL.width && y >= 0 && y <= SEL.height;
			},
		);
	async function creadoYElegido(caso: Caso) {
		const view = await mountWithSelection();
		if (caso.nombre !== "text") activate(caso.tool);
		caso.crear(view.container);
		activate("Seleccionar");
		dragReal(view.container, caso.cuerpo, caso.cuerpo);
		return view;
	}
	it.each(CASOS.filter((c) => c.nombre !== "text"))(
		"$nombre: todas sus manijas caen dentro de la selección",
		async (caso) => {
			const { container } = await creadoYElegido(caso);
			expect(dentro(container)).toBe(true);
		},
	);
	it("text: todas sus manijas caen dentro de la selección", async () => {
		const caso = CASOS.find((c) => c.nombre === "text") as Caso;
		const { container } = await creadoYElegido(caso);
		expect(dentro(container)).toBe(true);
	});

	it.each(CASOS)(
		"$nombre: crear, elegir con Seleccionar y ver las manijas esperadas",
		async (caso) => {
			const { container } = await mountWithSelection();
			// Texto activa su herramienta dentro de `crear` (activarla dos veces la apaga)
			if (caso.nombre !== "text") activate(caso.tool);
			caso.crear(container);
			activate("Seleccionar");
			dragReal(container, caso.cuerpo, caso.cuerpo);
			const ids = [
				...container.querySelectorAll<HTMLElement>("[data-annotation-handle]"),
			]
				.map((h) => h.dataset.annotationHandle as string)
				.sort();
			expect(ids).toEqual(caso.manijas);
			// cada manija es alcanzable por el puntero: el cursor ahí es de edición, no la manita ni el normal
			for (const id of ids) {
				const h = container.querySelector<HTMLElement>(
					`[data-annotation-handle="${id}"]`,
				);
				const x = 100 + Number.parseFloat(h?.style.left ?? "0");
				const y = 100 + Number.parseFloat(h?.style.top ?? "0");
				fireEvent.pointerMove(canvas(container), {
					pointerId: 1,
					clientX: x,
					clientY: y,
				});
				flushFrames();
				const cursor = canvas(container).style.cursor;
				expect(cursor, `${caso.nombre}/${id}`).not.toBe("default");
				expect(cursor, `${caso.nombre}/${id}`).not.toBe("grab");
			}
		},
	);
});

describe("texto elegido: recuadro punteado y alineación", () => {
	async function textoElegido() {
		const view = await mountWithSelection();
		createText(view.container, LARGO, [120, 150], "clic");
		activate("Seleccionar");
		dragReal(view.container, [140, 160], [140, 160]);
		return view;
	}
	const frames = (c: HTMLElement) =>
		c.querySelectorAll<HTMLElement>(
			'[data-testid="annotation-selection"] [data-text-frame]',
		);
	const handlePoint = (c: HTMLElement, id: string): [number, number] => {
		const h = c.querySelector<HTMLElement>(`[data-annotation-handle="${id}"]`);
		return [
			100 + Number.parseFloat(h?.style.left ?? "0"),
			100 + Number.parseFloat(h?.style.top ?? "0"),
		];
	};

	it("elegir un texto muestra un único recuadro punteado, con seis puntos de manija", async () => {
		const { container } = await textoElegido();
		expect(frames(container)).toHaveLength(1);
		expect(container.querySelectorAll("[data-handle-marker]")).toHaveLength(6);
	});

	it("un rectángulo elegido no tiene recuadro de texto", async () => {
		const { container } = await mountWithSelection();
		activate("Rectángulo");
		stroke([
			[150, 150],
			[300, 250],
		]);
		activate("Seleccionar");
		dragReal(container, [150, 200], [150, 200]);
		expect(frames(container)).toHaveLength(0);
	});

	it("el recuadro sigue visible y cambia de ancho MIENTRAS se arrastra el lado `e`", async () => {
		const { container } = await textoElegido();
		const width0 = Number.parseFloat(frames(container)[0].style.width);
		const [ex, ey] = handlePoint(container, "e");
		const el = topmostAt(container, ex, ey);
		fireEvent.pointerDown(el, {
			pointerId: 1,
			button: 0,
			clientX: ex,
			clientY: ey,
		});
		fireEvent.pointerMove(el, { pointerId: 1, clientX: ex - 120, clientY: ey });
		flushFrames();
		const mid = frames(container);
		expect(mid, "recuadro durante el arrastre").toHaveLength(1);
		expect(Number.parseFloat(mid[0].style.width)).toBeLessThan(width0);
		fireEvent.pointerUp(el, { pointerId: 1, clientX: ex - 120, clientY: ey });
		flushFrames();
		expect(frames(container)).toHaveLength(1);
	});

	it("mientras se edita el contenido SÍ hay recuadro (y sus manijas): se edita todo en el momento", async () => {
		const { container } = await textoElegido();
		fireEvent.keyDown(document.body, { key: "Enter", code: "Enter" });
		flushFrames();
		expect(screen.queryByLabelText("Editar el texto")).not.toBeNull();
		expect(frames(container)).toHaveLength(1);
	});

	const alineacionActual = () => String(ctx.textAlign);
	const boton = (n: string) => screen.getByRole("button", { name: n });

	it("hay un grupo «Alineación del texto» con tres botones; la izquierda está pulsada por defecto", async () => {
		await textoElegido();
		const g = screen.getByRole("group", { name: "Alineación del texto" });
		expect(g).not.toBeNull();
		expect(boton("Alinear a la izquierda")).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(boton("Alinear al centro")).toHaveAttribute("aria-pressed", "false");
		expect(boton("Alinear a la derecha")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	});

	it.each([
		["Alinear al centro", "center"],
		["Alinear a la derecha", "right"],
	] as const)(
		"«%s» cambia el texto elegido, se pinta con textAlign=%s y es UN paso de deshacer",
		async (nombre, align) => {
			await textoElegido();
			fireEvent.click(boton(nombre));
			paintedLines();
			expect(boton(nombre)).toHaveAttribute("aria-pressed", "true");
			expect(boton("Alinear a la izquierda")).toHaveAttribute(
				"aria-pressed",
				"false",
			);
			expect(alineacionActual()).toBe(align);
			fireEvent.click(screen.getByRole("button", { name: /Deshacer/i }));
			paintedLines();
			expect(boton("Alinear a la izquierda")).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(alineacionActual()).toBe("left");
			// el texto sigue ahí: solo se deshizo la alineación
			expect(paintedLines().length).toBeGreaterThan(1);
		},
	);

	it("elegir la izquierda estando ya a la izquierda no añade un paso de deshacer", async () => {
		await textoElegido();
		fireEvent.click(boton("Alinear a la izquierda"));
		fireEvent.click(screen.getByRole("button", { name: /Deshacer/i }));
		// el único paso deshecho fue la creación del texto
		expect(paintedLines()).toHaveLength(0);
	});

	it("la alineación elegida sin texto seleccionado vale para el siguiente texto", async () => {
		const { container } = await mountWithSelection();
		activate("Texto");
		fireEvent.click(boton("Alinear al centro"));
		activate("Texto"); // se desactiva al pulsar de nuevo: la volvemos a activar dentro de createText
		createText(container, "hola", [120, 150], "clic");
		paintedLines();
		expect(alineacionActual()).toBe("center");
	});

	it("la alineación se conserva al cambiar el ancho (lado `w`)", async () => {
		const { container } = await textoElegido();
		fireEvent.click(boton("Alinear al centro"));
		const [wx, wy] = handlePoint(container, "w");
		dragReal(container, [wx, wy], [wx + 40, wy]);
		paintedLines();
		expect(alineacionActual()).toBe("center");
		expect(boton("Alinear al centro")).toHaveAttribute("aria-pressed", "true");
	});
});
