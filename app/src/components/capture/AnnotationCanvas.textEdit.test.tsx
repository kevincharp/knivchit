import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas, type CanvasLayerApi } from "./AnnotationCanvas";
import {
	type Annotation,
	type AnnotationHistory,
	annotationBox,
	layoutText,
	redo,
	undo,
} from "./annotations";

/**
 * Edición del CONTENIDO de un texto ya insertado (doble clic o Enter), con el
 * área desplazada y escalada. Mismo montaje que AnnotationCanvas.edit.test.tsx:
 * área en imagen (200,100) 400×300, escala 0,5, canvas en pantalla (150,80).
 */
const SELECTION = { x: 200, y: 100, w: 400, h: 300 };
const SCALE = { x: 0.5, y: 0.5 };
const CANVAS = { left: 150, top: 80, width: 200, height: 150 };

const toClient = (x: number, y: number): [number, number] => [
	CANVAS.left + (x - SELECTION.x) * SCALE.x,
	CANVAS.top + (y - SELECTION.y) * SCALE.y,
];

const TEXT: Annotation = {
	id: "t",
	kind: "text",
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 260, y: 160 },
	end: { x: 260, y: 160 },
	text: "hola",
};
const RECT: Annotation = {
	id: "r",
	kind: "rect",
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 250, y: 150 },
	end: { x: 450, y: 300 },
};

let fillText: ReturnType<typeof vi.fn>;
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
	fillText = vi.fn();
	const store: Record<string, unknown> = { fillText };
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

function flushFrames() {
	act(() => {
		for (const cb of rafQueue.splice(0, rafQueue.length)) cb(0);
	});
}

/** Canvas con un historial real (estado), para comprobar también deshacer y rehacer. */
function setup(
	annotation: Annotation,
	selectedId: string | null = annotation.id,
) {
	const api = createRef<CanvasLayerApi>();
	const onSelect = vi.fn();
	let latest: AnnotationHistory = {
		past: [],
		present: [annotation],
		future: [],
	};
	function Harness() {
		const [history, setHistory] = useState(latest);
		latest = history;
		return (
			<AnnotationCanvas
				image={new Image()}
				selection={SELECTION}
				scale={SCALE}
				tool="select"
				color="#000000"
				strokeWidth={4}
				history={history}
				onHistoryChange={setHistory}
				selectedId={selectedId}
				onSelect={onSelect}
				layerRef={api}
			/>
		);
	}
	const view = render(<Harness />);
	const canvas = view.getByRole("img", {
		name: "Vista previa de la selección con anotaciones",
	});
	return {
		view,
		canvas,
		api,
		onSelect,
		history: () => latest,
		field: () =>
			view.queryByLabelText("Editar el texto") as HTMLTextAreaElement | null,
	};
}

function doubleClickAt(canvas: HTMLElement, at: [number, number]) {
	const [cx, cy] = toClient(...at);
	fireEvent.doubleClick(canvas, { clientX: cx, clientY: cy });
}

const INSIDE_TEXT: [number, number] = [289, 174];

describe("edición del contenido de un texto — dos caminos: doble clic y Enter", () => {
	it("doble clic sobre el texto abre el campo en su sitio, con el contenido y el cursor al final", () => {
		const { canvas, field, onSelect } = setup(TEXT, null);
		expect(field()).toBeNull();
		doubleClickAt(canvas, INSIDE_TEXT);
		const ta = field();
		expect(ta).not.toBeNull();
		expect(ta?.value).toBe("hola");
		expect(ta?.selectionStart).toBe(4);
		expect(onSelect).toHaveBeenCalledWith("t");
		// posición y tamaño en pantalla: (260-200)·0,5 = 30 ; (160-100)·0,5 = 30 ; 24·0,5 = 12
		// el borde punteado queda fuera de la caja de contenido: 1 px menos a la izquierda y arriba
		expect(ta?.style.left).toBe("29px");
		expect(ta?.style.top).toBe("29px");
		expect(ta?.style.fontSize).toBe("12px");
	});

	it("Enter con el texto elegido (editSelected) abre el mismo campo", () => {
		const { api, field } = setup(TEXT);
		let opened = false;
		act(() => {
			opened = api.current?.editSelected() ?? false;
		});
		expect(opened).toBe(true);
		expect(field()?.value).toBe("hola");
	});

	it("con una figura que no es texto, ni el doble clic ni editSelected abren nada", () => {
		const { api, canvas, field } = setup(RECT);
		doubleClickAt(canvas, [250, 190]);
		expect(field()).toBeNull();
		let opened = true;
		act(() => {
			opened = api.current?.editSelected() ?? true;
		});
		expect(opened).toBe(false);
		expect(field()).toBeNull();
	});

	it("doble clic en vacío no abre el campo", () => {
		const { canvas, field } = setup(TEXT, null);
		doubleClickAt(canvas, [500, 350]);
		expect(field()).toBeNull();
	});

	it("mientras se edita, el texto no se pinta en el canvas (no se ve doble)", () => {
		const { canvas } = setup(TEXT, null);
		flushFrames();
		expect(fillText).toHaveBeenCalledWith("hola", 260, 160);
		fillText.mockClear();
		doubleClickAt(canvas, INSIDE_TEXT);
		flushFrames();
		expect(fillText).not.toHaveBeenCalled();
	});
});

describe("edición del contenido — confirmar y cancelar", () => {
	function edit(text: string) {
		const s = setup(TEXT, null);
		doubleClickAt(s.canvas, INSIDE_TEXT);
		const ta = s.field() as HTMLTextAreaElement;
		fireEvent.change(ta, { target: { value: text } });
		return { ...s, ta };
	}

	it.each([
		[
			"Ctrl+Enter",
			(ta: HTMLElement) =>
				fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true }),
		],
		[
			"Esc (con contenido confirma, no cancela)",
			(ta: HTMLElement) => fireEvent.keyDown(ta, { key: "Escape" }),
		],
		["clic fuera (pierde el foco)", (ta: HTMLElement) => fireEvent.blur(ta)],
	] as const)(
		"%s confirma el contenido nuevo como UN paso de historial",
		(_n, confirm) => {
			const { history, field, ta } = edit("hola mundo");
			confirm(ta);
			expect(field()).toBeNull();
			expect(history().present[0].text).toBe("hola mundo");
			expect(history().past).toHaveLength(1);
			const back = undo(history());
			expect(back.present[0].text).toBe("hola");
			expect(redo(back).present[0].text).toBe("hola mundo");
		},
	);

	it("Enter dentro de la edición NO confirma: deja pasar el salto de línea", () => {
		const { history, field, ta } = edit("hola");
		const notPrevented = fireEvent.keyDown(ta, { key: "Enter" });
		expect(notPrevented).toBe(true);
		expect(field()).not.toBeNull();
		expect(history().past).toHaveLength(0);
	});

	it("confirmar sin cambiar el contenido no añade un paso al historial", () => {
		const { history, ta } = edit("hola");
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(history().past).toHaveLength(0);
		expect(history().present[0]).toEqual(TEXT);
	});

	it("Esc con el contenido vacío elimina el texto (un paso, deshacible) y lo deselecciona", () => {
		const { history, ta, onSelect, field } = edit("   ");
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(field()).toBeNull();
		expect(history().present).toEqual([]);
		expect(history().past).toHaveLength(1);
		expect(onSelect).toHaveBeenLastCalledWith(null);
		expect(undo(history()).present[0]).toEqual(TEXT);
	});

	it("Enter y la pérdida de foco que le sigue no confirman dos veces", () => {
		const { history, ta } = edit("otro");
		fireEvent.keyDown(ta, { key: "Enter", ctrlKey: true });
		fireEvent.blur(ta);
		expect(history().past).toHaveLength(1);
	});

	it("la tecla pulsada dentro del campo no sube a los atajos del overlay", () => {
		const { ta } = edit("hola");
		const spy = vi.fn();
		window.addEventListener("keydown", spy);
		fireEvent.keyDown(ta, { key: "h" });
		fireEvent.keyDown(ta, { key: "Escape" });
		window.removeEventListener("keydown", spy);
		expect(spy).not.toHaveBeenCalled();
	});
});

describe("redimensionar un texto con sus manijas desde el canvas (coordenadas de imagen)", () => {
	function drag(
		canvas: HTMLElement,
		from: [number, number],
		to: [number, number],
	) {
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
	}

	it("la esquina se arrastra: escala la fuente en proporción, un paso, y deshacer lo restituye exacto", () => {
		const { canvas, history } = setup(TEXT);
		// Caja 260,160 → 317,6 × 188,8. El doble desde nw: esquina se a (375,2 ; 217,6).
		drag(canvas, [317.6, 188.8], [375.2, 217.6]);
		const out = history().present[0];
		expect(out.font_size).toBeCloseTo(48, 6);
		expect(out.start).toEqual({ x: 260, y: 160 });
		expect(history().past).toHaveLength(1);
		expect(undo(history()).present[0]).toEqual(TEXT);
		expect(redo(undo(history())).present[0].font_size).toBeCloseTo(48, 6);
	});

	it("el lado e cambia el ancho del recuadro y reparte el texto en líneas; la fuente no cambia", () => {
		const long: Annotation = { ...TEXT, text: "hola mundo cruel" };
		const { canvas, history } = setup(long);
		// ancho estimado 16 car. × 14,4 = 230,4 ; asa e en (490,4 ; 174,4)
		drag(canvas, [490.4, 174.4], [260 + 100, 174.4]);
		const out = history().present[0];
		expect(out.box_width).toBeCloseTo(100, 6);
		expect(out.font_size).toBeUndefined();
		expect(history().past).toHaveLength(1);
		flushFrames();
		const drawn = fillText.mock.calls.map((c) => c[0]);
		expect(drawn.slice(-3)).toEqual(["hola", "mundo", "cruel"]);
	});

	it("no hay manija n/s: arrastrar por el borde superior mueve el texto entero", () => {
		const { canvas, history } = setup(TEXT);
		drag(canvas, [289, 160], [289, 200]);
		const out = history().present[0];
		expect(out.start).toEqual({ x: 260, y: 200 });
		expect(out.font_size).toBeUndefined();
	});
});

describe("crear un texto: el recuadro crece al escribir hasta el borde derecho del área", () => {
	function setupCreate() {
		let latest: AnnotationHistory = { past: [], present: [], future: [] };
		function Harness() {
			const [history, setHistory] = useState(latest);
			latest = history;
			return (
				<AnnotationCanvas
					image={new Image()}
					selection={SELECTION}
					scale={SCALE}
					tool="text"
					color="#ff0000"
					strokeWidth={4}
					history={history}
					onHistoryChange={setHistory}
				/>
			);
		}
		const view = render(<Harness />);
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		const field = () =>
			view.getByLabelText("Texto de la anotación") as HTMLTextAreaElement;
		function open(at: [number, number]) {
			const [cx, cy] = toClient(...at);
			fireEvent.pointerDown(canvas, {
				pointerId: 1,
				button: 0,
				clientX: cx,
				clientY: cy,
			});
			return field();
		}
		/** Escribe como el usuario: cada cambio dispara `input` y la anotación lo refleja. */
		function type(value: string) {
			fireEvent.input(field(), { target: { value } });
		}
		return {
			open,
			type,
			field,
			history: () => latest,
			live: () => latest.present[0],
			commit: () => fireEvent.keyDown(field(), { key: "Enter" }),
		};
	}
	// Área en imagen: x 200..600. Fuente por defecto 24 px → 14,4 px por carácter.
	const LONG =
		"una frase bastante larga que no cabe en una sola línea del área";
	const px = (v: string) => Number.parseFloat(v);

	it("nace estrecho en el punto del clic: sin ancho fijo, con el tope en el borde derecho del área", () => {
		const t = setupCreate();
		t.open([300, 200]);
		const a = t.live();
		expect(a.box_width).toBeUndefined();
		expect(a.max_right).toBe(588); // 600 − margen de 12
		expect(a.start).toEqual({ x: 300, y: 200 });
		// 2 caracteres (28,8) + una letra de holgura (24) = 52,8 px de imagen → 26,4 de pantalla
		expect(px(t.field().style.width)).toBeCloseTo(26.4, 6);
	});

	it("crece con lo que se escribe, en una sola línea, y el recuadro punteado en el modelo lo sigue", () => {
		const t = setupCreate();
		t.open([300, 200]);
		t.type("hola");
		const w1 = px(t.field().style.width);
		expect(annotationBox(t.live()).width).toBeCloseTo(4 * 14.4, 6);
		t.type("hola mundo");
		const w2 = px(t.field().style.width);
		expect(w2).toBeGreaterThan(w1);
		expect(annotationBox(t.live()).width).toBeCloseTo(10 * 14.4, 6);
		expect(layoutText(t.live())).toEqual(["hola mundo"]);
	});

	it("borrar texto hace que el recuadro encoja", () => {
		const t = setupCreate();
		t.open([300, 200]);
		t.type("hola mundo");
		const grown = px(t.field().style.width);
		t.type("ho");
		expect(px(t.field().style.width)).toBeLessThan(grown);
	});

	it("al llegar al borde derecho deja de crecer y baja de línea; luego crece en alto", () => {
		const t = setupCreate();
		t.open([300, 200]); // caben 300 px = 20 caracteres de 14,4
		t.type("aaaa bbbb cccc dddd");
		expect(layoutText(t.live())).toHaveLength(1);
		const w = px(t.field().style.width);
		t.type(LONG);
		const lines = layoutText(t.live());
		expect(lines.length).toBeGreaterThan(2);
		for (const l of lines) {
			expect(300 + l.length * 14.4).toBeLessThanOrEqual(600 + 1e-9);
		}
		// el campo no supera el tope (300 px de imagen → 150 de pantalla) y el alto crece
		expect(px(t.field().style.width)).toBeGreaterThanOrEqual(w);
		expect(px(t.field().style.width)).toBeLessThanOrEqual(150 + 1e-9);
		expect(annotationBox(t.live()).height).toBeGreaterThan(2 * 24 * 1.2);
	});

	it("saltos de línea manuales (Mayús+Enter / Enter al editar) se respetan", () => {
		const t = setupCreate();
		t.open([300, 200]);
		t.type("uno\ndos");
		expect(layoutText(t.live())).toEqual(["uno", "dos"]);
	});

	it("cerca del borde derecho se ancla a él con el ancho mínimo (8 caracteres) y no se sale", () => {
		const t = setupCreate();
		t.open([590, 200]);
		const a = t.live();
		expect(a.start.x).toBeCloseTo(588 - 115.2, 6);
		expect(a.start.y).toBe(200);
		t.type(LONG);
		for (const l of layoutText(t.live())) {
			expect(t.live().start.x + l.length * 14.4).toBeLessThanOrEqual(
				600 + 1e-9,
			);
		}
	});

	it("confirmar guarda el texto con ancho automático (sin box_width) en UN paso y el PNG pinta las mismas líneas", async () => {
		const t = setupCreate();
		t.open([300, 200]);
		t.type(LONG);
		t.commit();
		const saved = t.history().present[0];
		expect(saved.text).toBe(LONG);
		expect(saved.box_width).toBeUndefined();
		expect(saved.max_right).toBe(588);
		expect(t.history().past).toHaveLength(1);
		fillText.mockClear();
		const { renderSelection } = await import("./renderAnnotations");
		renderSelection(document.createElement("canvas"), new Image(), SELECTION, [
			saved,
		]);
		expect(fillText.mock.calls.map((c) => c[0])).toEqual(layoutText(saved));
		for (const [line, x] of fillText.mock.calls) {
			expect(x + (line as string).length * 14.4).toBeLessThanOrEqual(588);
		}
	});

	it("un clic en vacío sin escribir nada no deja texto huérfano ni pasos de historial", () => {
		const t = setupCreate();
		t.open([300, 200]);
		fireEvent.keyDown(t.field(), { key: "Escape" });
		expect(t.history().present).toEqual([]);
		expect(t.history().past).toHaveLength(0);
	});

	it("un segundo clic en vacío con el primer campo vacío lo descarta: nunca quedan dos campos", () => {
		const t = setupCreate();
		t.open([300, 200]);
		t.open([400, 300]);
		expect(document.querySelectorAll("textarea")).toHaveLength(1);
		expect(t.history().present).toHaveLength(1); // solo el nuevo, aún vacío
		expect(t.live().start).toEqual({ x: 400, y: 300 });
	});
});
