import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
	type Annotation,
	type AnnotationHistory,
	annotationBox,
	annotationHandles,
	MIN_ANNOTATION_SIZE,
} from "./annotations";

/**
 * Edición de figuras (mover, redimensionar por manijas, mover cada extremo de una flecha)
 * con el área de captura DESPLAZADA y ESCALADA. Los tests existentes usan
 * siempre un área en (0,0) con escala 1, donde un origen mal restado no se nota.
 *
 * Geometría: área en imagen (200,100) 400×300, escala 0,5; el canvas ocupa en
 * pantalla (150,80) 200×150. De pantalla a imagen:
 *   x_img = 200 + (cx − 150)·2    y_img = 100 + (cy − 80)·2
 */
const SELECTION = { x: 200, y: 100, w: 400, h: 300 };
const SCALE = { x: 0.5, y: 0.5 };
const CANVAS = { left: 150, top: 80, width: 200, height: 150 };

const toClient = (x: number, y: number): [number, number] => [
	CANVAS.left + (x - SELECTION.x) * SCALE.x,
	CANVAS.top + (y - SELECTION.y) * SCALE.y,
];

const base = {
	color: "#ff0000",
	stroke_width: 4,
};
const RECT: Annotation = {
	...base,
	id: "r",
	kind: "rect",
	start: { x: 250, y: 150 },
	end: { x: 450, y: 300 },
};
const ELLIPSE: Annotation = { ...RECT, id: "e", kind: "ellipse" };
const ARROW: Annotation = {
	...base,
	id: "f",
	kind: "arrow",
	start: { x: 260, y: 140 },
	end: { x: 500, y: 360 },
};

let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
	const store: Record<string, unknown> = {};
	const ctx = new Proxy(store, {
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
		...CANVAS,
		right: CANVAS.left + CANVAS.width,
		bottom: CANVAS.top + CANVAS.height,
		x: CANVAS.left,
		y: CANVAS.top,
	} as DOMRect);
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

function setup(
	annotation: Annotation,
	selectedId: string | null = annotation.id,
) {
	const history: AnnotationHistory = {
		past: [],
		present: [annotation],
		future: [],
	};
	const onHistoryChange = vi.fn();
	const onSelect = vi.fn();
	const view = render(
		<AnnotationCanvas
			image={new Image()}
			selection={SELECTION}
			scale={SCALE}
			tool="select"
			color="#000000"
			strokeWidth={4}
			history={history}
			onHistoryChange={onHistoryChange}
			selectedId={selectedId}
			onSelect={onSelect}
		/>,
	);
	const canvas = view.getByRole("img", {
		name: "Vista previa de la selección con anotaciones",
	});
	/** Arrastra de un punto de IMAGEN a otro y devuelve la anotación confirmada. */
	function drag(from: [number, number], to: [number, number]) {
		const [fx, fy] = toClient(...from);
		const [tx, ty] = toClient(...to);
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: fx,
			clientY: fy,
		});
		fireEvent.pointerMove(canvas, { pointerId: 1, clientX: tx, clientY: ty });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: tx, clientY: ty });
		const calls = onHistoryChange.mock.calls;
		const last = calls[calls.length - 1]?.[0] as AnnotationHistory | undefined;
		return last?.present[0];
	}
	return { drag, onHistoryChange, onSelect, view };
}

describe("edición de figuras con el área desplazada y escalada", () => {
	it("arrastrar el cuerpo mueve la figura lo que se movió el puntero, en px de imagen", () => {
		const { drag } = setup(RECT);
		// Borde izquierdo del rectángulo (250, 190) → 30 px de pantalla a la derecha y 10 abajo.
		const out = drag([250, 190], [250 + 60, 190 + 20]);
		expect(out?.start).toEqual({ x: 310, y: 170 });
		expect(out?.end).toEqual({ x: 510, y: 320 });
	});

	it.each([
		["nw", [250, 150], [230, 120], { x: 450, y: 300 }, { x: 230, y: 120 }],
		["ne", [450, 150], [520, 120], { x: 250, y: 300 }, { x: 520, y: 120 }],
		["sw", [250, 300], [230, 360], { x: 450, y: 150 }, { x: 230, y: 360 }],
		["se", [450, 300], [560, 380], { x: 250, y: 150 }, { x: 560, y: 380 }],
	] as const)(
		"rectángulo: la manija %s cambia el tamaño y deja fija la esquina opuesta",
		(_h, from, to, fixed, moved) => {
			const { drag } = setup(RECT);
			const out = drag([from[0], from[1]], [to[0], to[1]]);
			expect(out?.kind).toBe("rect");
			// Se compara la caja, no el orden start/end: es un detalle del modelo.
			expect(out && annotationBox(out)).toEqual({
				x: Math.min(fixed.x, moved.x),
				y: Math.min(fixed.y, moved.y),
				width: Math.abs(moved.x - fixed.x),
				height: Math.abs(moved.y - fixed.y),
			});
		},
	);

	// El asa de la elipse está sobre el contorno, en la diagonal de cada esquina de su
	// caja (centro 350,225; radios 100 y 75): ahí se agarra, queda donde se suelta
	// y la esquina opuesta no se mueve.
	it.each([
		["nw", [279.29, 171.97], [-20, -30], { x: 450, y: 300 }],
		["ne", [420.71, 171.97], [70, -30], { x: 250, y: 300 }],
		["sw", [279.29, 278.03], [-20, 60], { x: 450, y: 150 }],
		["se", [420.71, 278.03], [110, 80], { x: 250, y: 150 }],
	] as const)(
		"elipse: la manija %s (en el contorno) redimensiona, queda donde se suelta y deja fija la opuesta",
		(h, from, delta, fixed) => {
			const { drag } = setup(ELLIPSE);
			const to = [from[0] + delta[0], from[1] + delta[1]];
			const out = drag([from[0], from[1]], [to[0], to[1]]);
			expect(out?.kind).toBe("ellipse");
			if (!out) return;
			const box = annotationBox(out);
			const opposite = {
				x: fixed.x === box.x ? box.x : box.x + box.width,
				y: fixed.y === box.y ? box.y : box.y + box.height,
			};
			expect(opposite).toEqual(fixed);
			const moved = annotationHandles(out).find((m) => m.id === h)?.point;
			// El punto de contacto pasa de (from) a donde se soltó, no a un lado
			expect(moved?.x).toBeCloseTo(to[0], 1);
			expect(moved?.y).toBeCloseTo(to[1], 1);
		},
	);

	it("rectángulo: llevar una manija al otro lado de la opuesta invierte la figura sin perder tamaño", () => {
		const { drag } = setup(RECT);
		const out = drag([450, 300], [150, 100]);
		const box = out ? annotationBox(out) : null;
		expect(box).toEqual({ x: 150, y: 100, width: 100, height: 50 });
	});

	it("flecha: arrastrar el extremo final cambia orientación y longitud; el inicial queda fijo", () => {
		const { drag } = setup(ARROW);
		const out = drag([500, 360], [300, 200]);
		expect(out?.start).toEqual(ARROW.start);
		expect(out?.end).toEqual({ x: 300, y: 200 });
	});

	it("flecha: arrastrar el extremo inicial lo mueve sin tocar el final", () => {
		const { drag } = setup(ARROW);
		const out = drag([260, 140], [220, 400]);
		expect(out?.start).toEqual({ x: 220, y: 400 });
		expect(out?.end).toEqual(ARROW.end);
	});

	it("flecha: el cuerpo (no un extremo) mueve la flecha entera sin cambiar su orientación", () => {
		const { drag } = setup(ARROW);
		// Punto medio de la flecha: (380, 250).
		const out = drag([380, 250], [380 + 20, 250 - 40]);
		expect(out?.start).toEqual({ x: 280, y: 100 });
		expect(out?.end).toEqual({ x: 520, y: 320 });
	});

	it("una manija de una figura NO elegida no se agarra: el gesto selecciona y mueve el cuerpo", () => {
		const { drag, onSelect } = setup(RECT, null);
		// Sobre el borde, pero lejos de cualquier esquina: mover, no redimensionar.
		const out = drag([250, 190], [260, 230]);
		expect(onSelect).toHaveBeenCalledWith("r");
		expect(out?.start).toEqual({ x: 260, y: 150 + 40 });
		expect(out && annotationBox(out).width).toBe(200);
	});
});

/**
 * Cambio de diseño tras 6b8e370: la figura elegida no muestra marco ni
 * manijas; el cursor indica el modo edición y las zonas sensibles (invisibles)
 * son cómodas. Los tests `diseno(...)` se activan al publicar el frontend
 * (`diseno = it.skip` → `it`).
 */
const diseno = it;

describe("modo edición indicado por el cursor, con zonas sensibles de ≥12 px", () => {
	function hover(
		canvas: HTMLElement,
		at: [number, number],
		offset: [number, number] = [0, 0],
	) {
		const [cx, cy] = toClient(...at);
		fireEvent.pointerMove(canvas, {
			pointerId: 1,
			clientX: cx + offset[0],
			clientY: cy + offset[1],
		});
		act(() => {
			for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
		});
		return canvas.style.cursor;
	}
	const canvasOf = (view: ReturnType<typeof setup>["view"]) =>
		view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});

	it.each([
		["cuerpo (borde)", [250, 190], "grab"],
		["esquina nw", [250, 150], "nwse-resize"],
		["esquina se", [450, 300], "nwse-resize"],
		["esquina ne", [450, 150], "nesw-resize"],
		["esquina sw", [250, 300], "nesw-resize"],
	] as const)(
		"rectángulo elegido, puntero en %s: cursor %s",
		(_n, at, cursor) => {
			const { view } = setup(RECT);
			expect(hover(canvasOf(view), [at[0], at[1]])).toBe(cursor);
		},
	);

	it("flecha elegida: cursor propio en cada extremo (distinto de `grab` y de `default`) y `grab` en el cuerpo", () => {
		const { view } = setup(ARROW);
		const c = canvasOf(view);
		const inicio = hover(c, [260, 140]);
		const fin = hover(c, [500, 360]);
		expect(inicio).toBe(fin);
		expect(inicio).not.toBe("grab");
		expect(inicio).not.toBe("default");
		expect(hover(c, [380, 250])).toBe("grab");
	});

	it("en vacío el cursor no es de edición", () => {
		const { view } = setup(RECT);
		expect(hover(canvasOf(view), [580, 120])).toBe("default");
	});

	diseno.each([
		["nw", [250, 150], [-11, 0]],
		["se", [450, 300], [11, 0]],
		["ne", [450, 150], [0, -11]],
	] as const)(
		"una pulsación a 11 px de pantalla de la manija %s la agarra (zona ≥12 px, escala 0,5)",
		(_h, corner, off) => {
			const { view, onHistoryChange } = setup(RECT);
			const c = canvasOf(view);
			const [cx, cy] = toClient(corner[0], corner[1]);
			fireEvent.pointerDown(c, {
				pointerId: 1,
				button: 0,
				clientX: cx + off[0],
				clientY: cy + off[1],
			});
			fireEvent.pointerMove(c, {
				pointerId: 1,
				clientX: cx + off[0] + off[0],
				clientY: cy + off[1] + off[1],
			});
			fireEvent.pointerUp(c, { pointerId: 1 });
			const calls = onHistoryChange.mock.calls;
			const out = (
				calls[calls.length - 1]?.[0] as AnnotationHistory | undefined
			)?.present[0];
			// Redimensionó (cambió el tamaño), no movió: el ancho/alto de la caja cambia.
			const box = out ? annotationBox(out) : null;
			expect(box && (box.width !== 200 || box.height !== 150)).toBe(true);
		},
	);

	diseno(
		"el cursor de manija también se muestra a 11 px de pantalla de ella",
		() => {
			const { view } = setup(RECT);
			expect(hover(canvasOf(view), [250, 150], [-11, 0])).toBe("nwse-resize");
		},
	);
});

/**
 * Pendiente 1 de `2026-10-15-pendientes-pulido.md` (frontend 3fea17b): con
 * Seleccionar, el cuerpo o la línea de una figura muestra la manita abierta
 * (`grab`); las esquinas de rectángulo y elipse conservan las flechas de
 * redimensión y los extremos de una flecha el cursor de nodo. Zona sensible:
 * cualquier punto de la línea (con tolerancia) y el centro de las figuras
 * cerradas. Geometría como arriba: escala 0,5 (1 px de pantalla = 2 de imagen).
 */
describe("manita (`grab`) sobre el cuerpo de la figura con Seleccionar", () => {
	function hoverAt(
		view: ReturnType<typeof setup>["view"],
		at: [number, number],
	) {
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		const [cx, cy] = toClient(at[0], at[1]);
		fireEvent.pointerMove(canvas, { pointerId: 1, clientX: cx, clientY: cy });
		act(() => {
			for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
		});
		return canvas.style.cursor;
	}
	/** Monta una figura elegida (desmontando la anterior) y devuelve el cursor sobre `at`. */
	function cursorOn(ann: Annotation, at: [number, number]) {
		cleanup();
		return hoverAt(setup(ann).view, at);
	}
	const PEN: Annotation = {
		...base,
		id: "p",
		kind: "pen",
		start: { x: 260, y: 160 },
		end: { x: 440, y: 160 },
		points: [
			{ x: 260, y: 160 },
			{ x: 350, y: 200 },
			{ x: 440, y: 160 },
		],
	};
	const MOSAIC: Annotation = { ...PEN, id: "m", kind: "mosaic" };
	const TEXT: Annotation = {
		...base,
		id: "t",
		kind: "text",
		text: "hola",
		start: { x: 260, y: 160 },
		end: { x: 260, y: 160 },
	};

	it("el cuerpo (borde) de un rectángulo y de una elipse es una manita, no `move`", () => {
		expect(cursorOn(RECT, [250, 190])).toBe("grab");
		expect(cursorOn(ELLIPSE, [257.61, 196.29])).toBe("grab");
	});

	// Decisión (2026-10-15, revisable): la manita es solo del contorno; el interior
	// sigue siendo «vacío» (arrastrar ahí mueve el área, L3(e)).
	it("el centro de un rectángulo y de una elipse sin relleno no es zona de agarre: cursor normal", () => {
		expect(cursorOn(RECT, [350, 225])).toBe("default");
		expect(cursorOn(ELLIPSE, [350, 225])).toBe("default");
	});

	it("las esquinas conservan las flechas de redimensión (no la manita) en rectángulo y elipse", () => {
		expect(cursorOn(RECT, [250, 150])).toBe("nwse-resize");
		expect(cursorOn(ELLIPSE, [420.71, 171.97])).toBe("nesw-resize");
		expect(cursorOn(ELLIPSE, [279.29, 171.97])).toBe("nwse-resize");
	});

	it("cualquier punto de la línea de una flecha es una manita, con tolerancia de unos píxeles", () => {
		// punto medio exacto de la flecha y un punto a ~6 px de imagen de la línea
		expect(cursorOn(ARROW, [380, 250])).toBe("grab");
		expect(cursorOn(ARROW, [300, 177])).toBe("grab");
		// cuarto de recorrido: lejos de los extremos
		expect(cursorOn(ARROW, [320, 195])).toBe("grab");
	});

	it("lejos de la línea de la flecha el cursor es el normal", () => {
		expect(cursorOn(ARROW, [300, 330])).toBe("default");
	});

	it("los extremos de la flecha conservan el cursor de nodo, distinto de la manita", () => {
		const nodo = cursorOn(ARROW, [260, 140]);
		expect(nodo).not.toBe("grab");
		expect(nodo).not.toBe("default");
		expect(cursorOn(ARROW, [500, 360])).toBe(nodo);
	});

	it.each([
		["lápiz", PEN, [350, 200]],
		["mosaico", MOSAIC, [350, 200]],
	] as const)(
		"%s (solo se mueve): manita sobre el trazo, sin cursor de redimensión",
		(_n, ann, at) => {
			const cursor = cursorOn(ann, [at[0], at[1]]);
			expect(cursor).toBe("grab");
			expect(cursor).not.toMatch(/resize/);
		},
	);

	it("texto: manita en el cuerpo, flechas diagonales en las esquinas y horizontal en los lados e/w; sin manijas n/s", () => {
		// Caja estimada 260,160 → 317,6 × 188,8
		expect(cursorOn(TEXT, [289, 174])).toBe("grab");
		expect(cursorOn(TEXT, [260, 160])).toBe("nwse-resize");
		expect(cursorOn(TEXT, [317.6, 160])).toBe("nesw-resize");
		expect(cursorOn(TEXT, [317.6, 174.4])).toBe("ew-resize");
		expect(cursorOn(TEXT, [260, 174.4])).toBe("ew-resize");
		// Arriba y abajo del centro: cuerpo, no `ns-resize`
		expect(cursorOn(TEXT, [289, 160])).toBe("grab");
		expect(cursorOn(TEXT, [289, 188.8])).toBe("grab");
	});

	it("arrastrar el cuerpo cambia a la manita cerrada y al soltar vuelve a la abierta", () => {
		const { view } = setup(RECT);
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		const [cx, cy] = toClient(250, 190);
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: cx,
			clientY: cy,
		});
		expect(canvas.style.cursor).toBe("grabbing");
		fireEvent.pointerMove(canvas, {
			pointerId: 1,
			clientX: cx + 10,
			clientY: cy + 5,
		});
		act(() => {
			for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
		});
		expect(canvas.style.cursor).toBe("grabbing");
		fireEvent.pointerUp(canvas, {
			pointerId: 1,
			clientX: cx + 10,
			clientY: cy + 5,
		});
		expect(hoverAt(view, [260, 195])).toBe("grab");
	});

	it("arrastrar una manija de redimensión también muestra la manita cerrada", () => {
		const { view } = setup(RECT);
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		const [cx, cy] = toClient(450, 300);
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: cx,
			clientY: cy,
		});
		expect(canvas.style.cursor).toBe("grabbing");
	});
});

/**
 * Regresión «por experiencia» (bug de la elipse, 2026-10-15): sin marco, el
 * usuario solo ve la LÍNEA dibujada. Se recorre esa línea entera con el
 * puntero y se mira qué cursor sale. Para toda figura cerrada debe haber
 * zonas de redimensión en las 8 posiciones (cuatro esquinas/diagonales y
 * cuatro lados/cardinales), manita entre ellas y nunca el cursor normal ni
 * `move` sobre la línea. Activo desde d947593 (8 manijas comunes a rect y
 * elipse, las de la elipse sobre la curva).
 */
const experiencia = it;

describe("recorrer con el puntero la línea dibujada de una figura cerrada, sin marco", () => {
	function outline(f: Annotation, n: number): [number, number][] {
		const x0 = Math.min(f.start.x, f.end.x);
		const x1 = Math.max(f.start.x, f.end.x);
		const y0 = Math.min(f.start.y, f.end.y);
		const y1 = Math.max(f.start.y, f.end.y);
		const pts: [number, number][] = [];
		for (let i = 0; i < n; i++) {
			const t = (i / n) * 2 * Math.PI;
			if (f.kind === "ellipse") {
				pts.push([
					(x0 + x1) / 2 + ((x1 - x0) / 2) * Math.cos(t),
					(y0 + y1) / 2 + ((y1 - y0) / 2) * Math.sin(t),
				]);
			} else {
				// perímetro del rectángulo, recorrido por distancia
				const w = x1 - x0;
				const h = y1 - y0;
				const d = (i / n) * 2 * (w + h);
				if (d < w) pts.push([x0 + d, y0]);
				else if (d < w + h) pts.push([x1, y0 + (d - w)]);
				else if (d < 2 * w + h) pts.push([x1 - (d - w - h), y1]);
				else pts.push([x0, y1 - (d - 2 * w - h)]);
			}
		}
		return pts;
	}

	function cursorsAlongOutline(f: Annotation): Set<string> {
		cleanup();
		const { view } = setup(f);
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		const seen = new Set<string>();
		for (const [x, y] of outline(f, 360)) {
			const [cx, cy] = toClient(x, y);
			fireEvent.pointerMove(canvas, { pointerId: 1, clientX: cx, clientY: cy });
			act(() => {
				for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
			});
			seen.add(canvas.style.cursor);
		}
		return seen;
	}

	experiencia.each([
		["rectángulo", RECT],
		["elipse", ELLIPSE],
	] as const)(
		"%s: sobre su línea salen los cuatro cursores de redimensión y la manita; nunca `default` ni `move`",
		(_n, fig) => {
			const seen = cursorsAlongOutline(fig);
			for (const c of [
				"nwse-resize",
				"nesw-resize",
				"ns-resize",
				"ew-resize",
				"grab",
			]) {
				expect(seen, `falta ${c}`).toContain(c);
			}
			expect(seen).not.toContain("default");
			expect(seen).not.toContain("move");
		},
	);
});

/** Cursor por manija, redimensionado en píxeles de imagen, un paso de historial y figuras pequeñas. */
describe("8 manijas de rect y elipse: cursor, redimensionado y figura pequeña", () => {
	const canvasOf = (view: ReturnType<typeof setup>["view"]) =>
		view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
	const flush = () =>
		act(() => {
			for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
		});
	const CURSOR_DE: Record<string, string> = {
		nw: "nwse-resize",
		se: "nwse-resize",
		ne: "nesw-resize",
		sw: "nesw-resize",
		n: "ns-resize",
		s: "ns-resize",
		e: "ew-resize",
		w: "ew-resize",
	};
	const ids = Object.keys(CURSOR_DE);

	it.each(
		(["rect", "ellipse"] as const).flatMap((kind) =>
			ids.map((id) => [kind, id] as const),
		),
	)("%s: el cursor sobre la manija %s es el de su dirección", (kind, id) => {
		const fig = kind === "rect" ? RECT : ELLIPSE;
		const h = annotationHandles(fig).find((m) => m.id === id);
		expect(h).toBeDefined();
		const { view } = setup(fig);
		const c = canvasOf(view);
		const [cx, cy] = toClient(h?.point.x ?? 0, h?.point.y ?? 0);
		fireEvent.pointerMove(c, { pointerId: 1, clientX: cx, clientY: cy });
		flush();
		expect(c.style.cursor).toBe(CURSOR_DE[id]);
	});

	/** Arrastra la manija `id` `d` píxeles de PANTALLA y devuelve el historial resultante. */
	function drag(fig: Annotation, id: string, d: [number, number]) {
		const h = annotationHandles(fig).find((m) => m.id === id);
		const { view, onHistoryChange } = setup(fig);
		const c = canvasOf(view);
		const [cx, cy] = toClient(h?.point.x ?? 0, h?.point.y ?? 0);
		fireEvent.pointerDown(c, {
			pointerId: 1,
			button: 0,
			clientX: cx,
			clientY: cy,
		});
		fireEvent.pointerMove(c, {
			pointerId: 1,
			clientX: cx + d[0],
			clientY: cy + d[1],
		});
		fireEvent.pointerUp(c, {
			pointerId: 1,
			clientX: cx + d[0],
			clientY: cy + d[1],
		});
		const calls = onHistoryChange.mock.calls;
		return {
			calls,
			last: calls[calls.length - 1]?.[0] as AnnotationHistory | undefined,
			from: h?.point ?? { x: 0, y: 0 },
		};
	}

	it.each(
		(["rect", "ellipse"] as const).flatMap((kind) =>
			ids.map((id) => [kind, id] as const),
		),
	)(
		"%s, manija %s: arrastrar d px de pantalla mueve la manija 2·d px de imagen (escala 0,5) y deja quieto el borde opuesto",
		(kind, id) => {
			const fig = kind === "rect" ? RECT : ELLIPSE;
			const before = annotationBox(fig);
			// hacia dentro, para no cruzar el borde opuesto
			const sx = id.includes("e") ? -1 : id.includes("w") ? 1 : 0;
			const sy = id.includes("s") ? -1 : id.includes("n") ? 1 : 0;
			const { last, from } = drag(fig, id, [sx * 10, sy * 8]);
			const out = last?.present[0];
			expect(out).toBeDefined();
			const after = annotationBox(out as Annotation);
			const moved = annotationHandles(out as Annotation).find(
				(m) => m.id === id,
			)?.point;
			if (sx !== 0) expect(moved?.x).toBeCloseTo(from.x + sx * 20, 6);
			if (sy !== 0) expect(moved?.y).toBeCloseTo(from.y + sy * 16, 6);
			// el borde opuesto no se mueve; el eje que la manija no toca, tampoco
			if (id.includes("e")) expect(after.x).toBeCloseTo(before.x, 6);
			if (id.includes("w"))
				expect(after.x + after.width).toBeCloseTo(before.x + before.width, 6);
			if (id.includes("s")) expect(after.y).toBeCloseTo(before.y, 6);
			if (id.includes("n"))
				expect(after.y + after.height).toBeCloseTo(before.y + before.height, 6);
			if (sx === 0) {
				expect(after.x).toBeCloseTo(before.x, 6);
				expect(after.width).toBeCloseTo(before.width, 6);
			}
			if (sy === 0) {
				expect(after.y).toBeCloseTo(before.y, 6);
				expect(after.height).toBeCloseTo(before.height, 6);
			}
		},
	);

	it.each(["rect", "ellipse"] as const)(
		"%s: una edición es UN paso de historial y deshacer devuelve la figura intacta",
		(kind) => {
			const fig = kind === "rect" ? RECT : ELLIPSE;
			const { last } = drag(fig, "se", [-20, -15]);
			expect(last?.past).toHaveLength(1);
			expect(last?.past[0]).toEqual([fig]);
			expect(last?.present[0]).not.toEqual(fig);
		},
	);

	it.each(["rect", "ellipse"] as const)(
		"%s: llevar la manija sobre el borde opuesto no colapsa la figura (lado mínimo MIN_ANNOTATION_SIZE)",
		(kind) => {
			const fig = kind === "rect" ? RECT : ELLIPSE;
			// e: hasta pasar muy por detrás del borde izquierdo
			const { last } = drag(fig, "e", [-400, 0]);
			const box = annotationBox(last?.present[0] as Annotation);
			expect(box.width).toBeGreaterThanOrEqual(MIN_ANNOTATION_SIZE);
			expect(box.height).toBeCloseTo(annotationBox(fig).height, 6);
		},
	);

	// Regresión (resuelta en fc01610: zona de manija = min(pedido, lado menor / 6)):
	// con zonas de 14 px de pantalla, en una figura de ~40×30 px las 8 manijas
	// cubrían todo el trazo y el cuerpo no se podía agarrar.
	it.each(["rect", "ellipse"] as const)(
		"%s pequeña (80×60 px de imagen = 40×30 en pantalla): queda un trozo del trazo donde el cursor es la manita",
		(kind) => {
			const small: Annotation = {
				...RECT,
				id: "s",
				kind,
				start: { x: 300, y: 200 },
				end: { x: 380, y: 260 },
			};
			cleanup();
			const { view } = setup(small);
			const c = canvasOf(view);
			const seen = new Set<string>();
			const b = annotationBox(small);
			for (let i = 0; i < 360; i++) {
				const t = (i / 360) * 2 * Math.PI;
				const x = b.x + b.width / 2 + (b.width / 2) * Math.cos(t);
				const y = b.y + b.height / 2 + (b.height / 2) * Math.sin(t);
				const [cx, cy] = toClient(x, y);
				fireEvent.pointerMove(c, { pointerId: 1, clientX: cx, clientY: cy });
				flush();
				seen.add(c.style.cursor);
			}
			expect(seen, "el cuerpo debe seguir siendo alcanzable").toContain("grab");
		},
	);
});
