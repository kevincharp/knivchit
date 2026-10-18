import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
	type Annotation,
	type AnnotationHistory,
	annotationHandles,
} from "./annotations";

/**
 * Pauta de rendimiento por gesto (se cuenta TRABAJO, no milisegundos: jsdom no mide tiempos fiables).
 * Para CADA figura y CADA gesto de edición (mover, y redimensionar con cada clase de manija) se
 * emiten 200 `pointermove` dentro de un solo frame y se mide, antes de soltar:
 *   - redibujados del canvas (pasadas de `clearRect`) tras vaciar el frame,
 *   - llamadas a `getBoundingClientRect` (layout síncrono) durante el gesto,
 *   - commits de React del subárbol (Profiler).
 * El borrador se coalesce por frame: ≤ 10 commits por 200 eventos (sin coalescer eran 201). Los
 * presupuestos valen para cualquier figura nueva: basta añadirla a FIGURAS.
 */
const SELECTION = { x: 200, y: 100, w: 400, h: 300 };
const SCALE = { x: 0.5, y: 0.5 };
const CANVAS = { left: 150, top: 80, width: 200, height: 150 };
const EVENTS = 200;

/** Presupuestos por 200 pointermove en un frame. */
const BUDGET = {
	/** Pasadas completas de redibujado tras vaciar el frame: una por frame. */
	redraws: 1,
	/** Layout síncrono durante el gesto: la caja del canvas se mide una vez por commit de posición, no por evento. */
	layouts: 1,
	/**
	 * Commits de React durante el gesto: acotados por frames, no por eventos. El
	 * borrador vive en un ref y solo se publica una vez por frame (publishDraft);
	 * antes había uno por pointermove (201 por 200 eventos).
	 */
	commits: 10,
};

const toClient = (x: number, y: number): [number, number] => [
	CANVAS.left + (x - SELECTION.x) * SCALE.x,
	CANVAS.top + (y - SELECTION.y) * SCALE.y,
];

const base = { color: "#ff0000", stroke_width: 4 };
const FIGURAS: Record<string, Annotation> = {
	rect: {
		...base,
		id: "f",
		kind: "rect",
		start: { x: 250, y: 150 },
		end: { x: 450, y: 300 },
	},
	ellipse: {
		...base,
		id: "f",
		kind: "ellipse",
		start: { x: 250, y: 150 },
		end: { x: 450, y: 300 },
	},
	arrow: {
		...base,
		id: "f",
		kind: "arrow",
		start: { x: 260, y: 140 },
		end: { x: 500, y: 360 },
	},
	pen: {
		...base,
		id: "f",
		kind: "pen",
		start: { x: 260, y: 160 },
		end: { x: 440, y: 160 },
		points: Array.from({ length: 60 }, (_, i) => ({
			x: 260 + i * 3,
			y: 160 + Math.sin(i / 4) * 30,
		})),
	},
	mosaic: {
		...base,
		id: "f",
		kind: "mosaic",
		start: { x: 260, y: 160 },
		end: { x: 440, y: 160 },
		points: Array.from({ length: 60 }, (_, i) => ({
			x: 260 + i * 3,
			y: 160 + Math.sin(i / 4) * 30,
		})),
	},
	// 5 líneas, el caso de la queja: texto largo con ancho fijo que se reparte.
	text: {
		...base,
		id: "f",
		kind: "text",
		start: { x: 260, y: 160 },
		end: { x: 260, y: 160 },
		text: "primera línea del texto\nsegunda línea algo más larga que la primera\ntercera\ncuarta línea con palabras sueltas para repartir\nquinta",
		font_size: 24,
		box_width: 220,
	},
};

let rafQueue: FrameRequestCallback[] = [];
let calls: Record<string, ReturnType<typeof vi.fn>> = {};
let rectCalls = 0;

beforeEach(() => {
	calls = {};
	rectCalls = 0;
	const ctx = new Proxy({} as Record<string, unknown>, {
		get: (t, k: string) => {
			if (!(k in t)) t[k] = vi.fn();
			calls[k] = t[k] as ReturnType<typeof vi.fn>;
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
	).mockImplementation(() => {
		rectCalls++;
		return {
			...CANVAS,
			right: CANVAS.left + CANVAS.width,
			bottom: CANVAS.top + CANVAS.height,
			x: CANVAS.left,
			y: CANVAS.top,
		} as DOMRect;
	});
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
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

const flush = () =>
	act(() => {
		for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
	});

/** Monta la figura elegida y ejecuta un gesto de 200 pointermove; devuelve el trabajo medido. */
function measureGesture(fig: Annotation, grabAt: { x: number; y: number }) {
	let commits = 0;
	const history: AnnotationHistory = { past: [], present: [fig], future: [] };
	const view = render(
		<Profiler id="canvas" onRender={() => commits++}>
			<AnnotationCanvas
				image={new Image()}
				selection={SELECTION}
				scale={SCALE}
				tool="select"
				color="#000000"
				strokeWidth={4}
				history={history}
				onHistoryChange={vi.fn()}
				selectedId={fig.id}
				onSelect={vi.fn()}
			/>
		</Profiler>,
	);
	const canvas = view.getByRole("img", {
		name: "Vista previa de la selección con anotaciones",
	});
	flush();
	const [cx, cy] = toClient(grabAt.x, grabAt.y);
	fireEvent.pointerDown(canvas, {
		pointerId: 1,
		button: 0,
		clientX: cx,
		clientY: cy,
	});
	flush();
	// empieza a contar tras el pointerdown
	commits = 0;
	rectCalls = 0;
	calls.clearRect?.mockClear();
	for (let i = 1; i <= EVENTS; i++) {
		fireEvent.pointerMove(canvas, {
			pointerId: 1,
			clientX: cx + (i % 40) - 10,
			clientY: cy + ((i * 3) % 30) - 8,
		});
	}
	const commitsDuring = commits;
	const layouts = rectCalls;
	flush();
	const redraws = calls.clearRect?.mock.calls.length ?? 0;
	fireEvent.pointerUp(canvas, { pointerId: 1, clientX: cx, clientY: cy });
	return { commits: commitsDuring, layouts, redraws };
}

/** Punto de agarre: el cuerpo (línea) o una manija concreta de la figura. */
function grabPoints(fig: Annotation) {
	const handles = annotationHandles(fig);
	const out: [string, { x: number; y: number }][] = handles.map((h) => [
		`manija ${h.id}`,
		h.point,
	]);
	return out;
}

const CASOS = Object.entries(FIGURAS).flatMap(([nombre, fig]) => {
	const casos: [string, Annotation, { x: number; y: number }][] = [];
	// cuerpo: un punto sobre la figura que no sea manija
	const body: Record<string, { x: number; y: number }> = {
		rect: { x: 250, y: 225 },
		ellipse: { x: 250, y: 225 },
		arrow: { x: 380, y: 250 },
		pen: { x: 260 + 30 * 3, y: 160 + Math.sin(30 / 4) * 30 },
		mosaic: { x: 260 + 30 * 3, y: 160 + Math.sin(30 / 4) * 30 },
		text: { x: 280, y: 175 },
	};
	casos.push([`${nombre}: mover por el cuerpo`, fig, body[nombre]]);
	for (const [etiqueta, p] of grabPoints(fig)) {
		casos.push([`${nombre}: redimensionar (${etiqueta})`, fig, p]);
	}
	return casos;
});

describe("pauta de rendimiento: 200 pointermove en un frame, cualquier figura y gesto", () => {
	it("cubre las seis figuras", () => {
		expect(Object.keys(FIGURAS).sort()).toEqual(
			["arrow", "ellipse", "mosaic", "pen", "rect", "text"].sort(),
		);
	});

	it.each(CASOS)("%s", (_n, fig, at) => {
		const m = measureGesture(fig, at);
		expect(m.redraws, "redibujados del canvas").toBeLessThanOrEqual(
			BUDGET.redraws,
		);
		expect(m.layouts, "layouts síncronos").toBeLessThanOrEqual(BUDGET.layouts);
		expect(m.commits, "commits de React").toBeLessThanOrEqual(BUDGET.commits);
	});
});
