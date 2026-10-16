import { describe, expect, it } from "vitest";
import {
	type Annotation,
	type AnnotationHistory,
	addAnnotation,
	annotationBox,
	annotationHandles,
	canRedo,
	canUndo,
	createHistory,
	DEFAULT_ERASE_TOLERANCE,
	findAnnotationAt,
	findHandleAt,
	hitTest,
	layoutText,
	MAX_TEXT_FONT_SIZE,
	MIN_ANNOTATION_SIZE,
	MIN_TEXT_FONT_SIZE,
	moveAnnotation,
	newTextBox,
	redo,
	removeAnnotation,
	removeAnnotationAt,
	replaceAnnotation,
	resizeAnnotationHandle,
	TEXT_RIGHT_MARGIN,
	textFontSize,
	textWrapWidth,
	undo,
	updateAnnotation,
} from "./annotations";

function make(
	id: string,
	kind: Annotation["kind"],
	start: { x: number; y: number },
	end: { x: number; y: number },
	extra: Partial<Annotation> = {},
): Annotation {
	return { id, kind, color: "#ff0000", stroke_width: 2, start, end, ...extra };
}

const rect = (id: string, x = 0, y = 0, w = 100, h = 50) =>
	make(id, "rect", { x, y }, { x: x + w, y: y + h });

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}

function ids(h: AnnotationHistory): string[] {
	return h.present.map((a) => a.id);
}

describe("historial: añadir, deshacer, rehacer", () => {
	it("parte vacío y sin nada que deshacer ni rehacer", () => {
		const h = createHistory();
		expect(h.present).toEqual([]);
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(false);
	});

	it("añade encima de las demás, en orden", () => {
		let h = createHistory();
		h = addAnnotation(h, rect("a"));
		h = addAnnotation(h, rect("b"));
		expect(ids(h)).toEqual(["a", "b"]);
		expect(canUndo(h)).toBe(true);
	});

	it("deshace y rehace de uno en uno, en el orden correcto", () => {
		let h = createHistory();
		for (const id of ["a", "b", "c"]) h = addAnnotation(h, rect(id));
		h = undo(h);
		expect(ids(h)).toEqual(["a", "b"]);
		h = undo(h);
		expect(ids(h)).toEqual(["a"]);
		h = undo(h);
		expect(ids(h)).toEqual([]);
		h = redo(h);
		expect(ids(h)).toEqual(["a"]);
		h = redo(h);
		h = redo(h);
		expect(ids(h)).toEqual(["a", "b", "c"]);
	});

	it("deshacer sin historial devuelve la misma referencia", () => {
		const h = createHistory();
		expect(undo(h)).toBe(h);
	});

	it("rehacer sin nada que rehacer devuelve la misma referencia", () => {
		const h = addAnnotation(createHistory(), rect("a"));
		expect(redo(h)).toBe(h);
	});

	it("canUndo/canRedo siguen la posición en el historial", () => {
		let h = addAnnotation(createHistory(), rect("a"));
		h = undo(h);
		expect(canUndo(h)).toBe(false);
		expect(canRedo(h)).toBe(true);
		h = redo(h);
		expect(canUndo(h)).toBe(true);
		expect(canRedo(h)).toBe(false);
	});

	it("añadir tras deshacer descarta lo rehacible", () => {
		let h = createHistory();
		for (const id of ["a", "b", "c"]) h = addAnnotation(h, rect(id));
		h = undo(h);
		h = undo(h);
		h = addAnnotation(h, rect("d"));
		expect(ids(h)).toEqual(["a", "d"]);
		expect(canRedo(h)).toBe(false);
		expect(redo(h)).toBe(h);
	});

	it("deshacer y rehacer ida y vuelta restaura exactamente el estado", () => {
		let h = createHistory();
		for (const id of ["a", "b"]) h = addAnnotation(h, rect(id));
		const antes = h.present;
		expect(redo(undo(h)).present).toEqual(antes);
	});

	it("es inmutable: ninguna operación modifica el historial de entrada", () => {
		let h = createHistory();
		h = addAnnotation(h, rect("a"));
		h = addAnnotation(h, rect("b"));
		deepFreeze(h);
		expect(() => {
			addAnnotation(h, rect("c"));
			undo(h);
			redo(undo(h));
			removeAnnotationAt(h, { x: 0, y: 25 });
		}).not.toThrow();
		expect(ids(h)).toEqual(["a", "b"]);
	});

	it("no comparte el arreglo present entre estados distintos", () => {
		const h1 = addAnnotation(createHistory(), rect("a"));
		const h2 = addAnnotation(h1, rect("b"));
		expect(h1.present).not.toBe(h2.present);
		expect(ids(h1)).toEqual(["a"]);
	});
});

describe("annotationBox", () => {
	it("rect: caja normalizada con start en cualquier esquina", () => {
		const a = make("r", "rect", { x: 100, y: 80 }, { x: 20, y: 10 });
		expect(annotationBox(a)).toEqual({ x: 20, y: 10, width: 80, height: 70 });
	});

	it("ellipse: caja contenedora, no radio", () => {
		const a = make("e", "ellipse", { x: 10, y: 20 }, { x: 110, y: 80 });
		expect(annotationBox(a)).toEqual({ x: 10, y: 20, width: 100, height: 60 });
	});

	it("arrow con start > end: caja normalizada", () => {
		const a = make("f", "arrow", { x: 100, y: 80 }, { x: 20, y: 10 });
		expect(annotationBox(a)).toEqual({ x: 20, y: 10, width: 80, height: 70 });
	});

	it("mosaic: caja del recorrido ensanchada medio pincel por cada lado", () => {
		// stroke_width 2 → pincel de 12 px → radio 6.
		const a = make("m", "mosaic", { x: 50, y: 50 }, { x: 10, y: 90 });
		expect(annotationBox(a)).toEqual({ x: 4, y: 44, width: 52, height: 52 });
		const trazo = make(
			"m2",
			"mosaic",
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{
				stroke_width: 4,
				points: [
					{ x: 20, y: 30 },
					{ x: 60, y: 30 },
				],
			},
		);
		// stroke_width 4 → pincel de 24 px → radio 12.
		expect(annotationBox(trazo)).toEqual({
			x: 8,
			y: 18,
			width: 64,
			height: 24,
		});
	});

	it("pen: caja de todos los puntos del trazo", () => {
		const a = make(
			"p",
			"pen",
			{ x: 5, y: 5 },
			{ x: 5, y: 5 },
			{
				points: [
					{ x: 5, y: 5 },
					{ x: 40, y: -10 },
					{ x: 20, y: 30 },
				],
			},
		);
		expect(annotationBox(a)).toEqual({ x: 5, y: -10, width: 35, height: 40 });
	});

	it("pen sin points: cae a start/end", () => {
		const a = make("p", "pen", { x: 5, y: 5 }, { x: 5, y: 5 });
		expect(annotationBox(a)).toEqual({ x: 5, y: 5, width: 0, height: 0 });
	});

	it("la caja no incluye el ancho del trazo", () => {
		const a = { ...rect("r"), stroke_width: 40 };
		expect(annotationBox(a)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
	});

	it("text: estima 0.6·fuente por carácter y 1.2·fuente por línea", () => {
		const a = make(
			"t",
			"text",
			{ x: 10, y: 20 },
			{ x: 10, y: 20 },
			{ text: "hola", stroke_width: 3 },
		);
		expect(textFontSize(3)).toBe(18);
		const box = annotationBox(a);
		expect(box.x).toBe(10);
		expect(box.y).toBe(20);
		expect(box.width).toBeCloseTo(4 * 18 * 0.6);
		expect(box.height).toBeCloseTo(18 * 1.2);
	});

	it("text multilínea: ancho de la línea más larga, alto de todas", () => {
		const a = make(
			"t",
			"text",
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{ text: "ab\nabcd\nabc", stroke_width: 2 },
		);
		const box = annotationBox(a);
		expect(box.width).toBeCloseTo(4 * 12 * 0.6);
		expect(box.height).toBeCloseTo(3 * 12 * 1.2);
	});

	it("text vacío o sin texto no produce NaN ni lanza", () => {
		for (const text of ["", undefined]) {
			const a = make("t", "text", { x: 1, y: 2 }, { x: 1, y: 2 }, { text });
			const box = annotationBox(a);
			expect(Object.values(box).every(Number.isFinite)).toBe(true);
			expect(box.width).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("hitTest", () => {
	it("tolerancia por defecto es 6", () => {
		expect(DEFAULT_ERASE_TOLERANCE).toBe(6);
	});

	it("rect: responde en el contorno y no en el interior", () => {
		const a = rect("r"); // 0,0 → 100,50, trazo 2
		expect(hitTest(a, { x: 0, y: 25 })).toBe(true);
		expect(hitTest(a, { x: 100, y: 25 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 0 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 25 })).toBe(false);
	});

	it("rect: tolerancia en el borde exterior", () => {
		const a = rect("r"); // alcance = 6 + 1 = 7
		expect(hitTest(a, { x: -6.5, y: 25 })).toBe(true);
		expect(hitTest(a, { x: -7.5, y: 25 })).toBe(false);
		expect(hitTest(a, { x: 50, y: 50 + 7.5 })).toBe(false);
	});

	it("rect: tolerancia hacia el interior", () => {
		const a = rect("r");
		expect(hitTest(a, { x: 6.5, y: 25 })).toBe(true);
		expect(hitTest(a, { x: 7.5, y: 25 })).toBe(false);
	});

	it("rect: una tolerancia mayor alcanza más lejos", () => {
		const a = rect("r");
		expect(hitTest(a, { x: -20, y: 25 })).toBe(false);
		expect(hitTest(a, { x: -20, y: 25 }, 30)).toBe(true);
	});

	it("rect muy pequeño: se comporta como bloque sólido", () => {
		const a = make("r", "rect", { x: 0, y: 0 }, { x: 4, y: 4 });
		expect(hitTest(a, { x: 2, y: 2 })).toBe(true);
	});

	it("ellipse: responde en el contorno y no en el centro", () => {
		const a = make("e", "ellipse", { x: 0, y: 0 }, { x: 100, y: 60 });
		expect(hitTest(a, { x: 0, y: 30 })).toBe(true);
		expect(hitTest(a, { x: 100, y: 30 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 0 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 60 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 30 })).toBe(false);
	});

	it("ellipse: lejos del contorno no responde", () => {
		const a = make("e", "ellipse", { x: 0, y: 0 }, { x: 100, y: 60 });
		expect(hitTest(a, { x: 300, y: 300 })).toBe(false);
		expect(hitTest(a, { x: 50, y: 15 })).toBe(false);
	});

	it("ellipse degenerada (ancho 0) no lanza ni da NaN", () => {
		const a = make("e", "ellipse", { x: 10, y: 0 }, { x: 10, y: 50 });
		expect(() => hitTest(a, { x: 10, y: 25 })).not.toThrow();
		expect(hitTest(a, { x: 10, y: 25 })).toBe(true);
	});

	it("arrow: distancia al segmento, con tolerancia", () => {
		const a = make("f", "arrow", { x: 0, y: 0 }, { x: 100, y: 0 });
		expect(hitTest(a, { x: 50, y: 0 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 6 })).toBe(true);
		expect(hitTest(a, { x: 50, y: 20 })).toBe(false);
		// más allá de la punta, fuera del segmento
		expect(hitTest(a, { x: 130, y: 0 })).toBe(false);
	});

	it("arrow con start > end responde igual que al revés", () => {
		const a = make("f", "arrow", { x: 100, y: 0 }, { x: 0, y: 0 });
		expect(hitTest(a, { x: 30, y: 2 })).toBe(true);
	});

	it("arrow de longitud cero: responde solo cerca del punto", () => {
		const a = make("f", "arrow", { x: 10, y: 10 }, { x: 10, y: 10 });
		expect(hitTest(a, { x: 12, y: 10 })).toBe(true);
		expect(hitTest(a, { x: 60, y: 10 })).toBe(false);
	});

	it("pen: responde cerca de los segmentos del trazo, no de la caja", () => {
		const a = make(
			"p",
			"pen",
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{
				points: [
					{ x: 0, y: 0 },
					{ x: 100, y: 0 },
					{ x: 100, y: 100 },
				],
			},
		);
		expect(hitTest(a, { x: 50, y: 2 })).toBe(true);
		expect(hitTest(a, { x: 100, y: 60 })).toBe(true);
		expect(hitTest(a, { x: 10, y: 90 })).toBe(false); // dentro de la caja, lejos del trazo
	});

	it("pen de un solo punto: responde cerca del punto", () => {
		const a = make(
			"p",
			"pen",
			{ x: 20, y: 20 },
			{ x: 20, y: 20 },
			{ points: [{ x: 20, y: 20 }] },
		);
		expect(hitTest(a, { x: 22, y: 21 })).toBe(true);
		expect(hitTest(a, { x: 80, y: 80 })).toBe(false);
	});

	it("mosaic: responde por donde pasó el trazo (con todo el pincel), no en el rectángulo que lo envuelve", () => {
		// Trazo en L, pincel de 24 px (radio 12) y tolerancia 6.
		const a = make(
			"m",
			"mosaic",
			{ x: 0, y: 0 },
			{ x: 0, y: 0 },
			{
				stroke_width: 4,
				points: [
					{ x: 10, y: 10 },
					{ x: 10, y: 100 },
					{ x: 100, y: 100 },
				],
			},
		);
		expect(hitTest(a, { x: 10, y: 50 })).toBe(true);
		expect(hitTest(a, { x: 24, y: 50 })).toBe(true); // dentro del pincel
		expect(hitTest(a, { x: 50, y: 100 })).toBe(true);
		expect(hitTest(a, { x: 60, y: 40 })).toBe(false); // hueco de la L, dentro de su caja
		expect(hitTest(a, { x: 10, y: 130 })).toBe(false);
	});

	it("mosaic: un toque sin mover responde dentro de su pincel", () => {
		const a = make(
			"m",
			"mosaic",
			{ x: 40, y: 40 },
			{ x: 40, y: 40 },
			{
				stroke_width: 2,
				points: [{ x: 40, y: 40 }],
			},
		);
		expect(hitTest(a, { x: 40, y: 40 })).toBe(true);
		expect(hitTest(a, { x: 52, y: 40 })).toBe(true); // 6 de pincel + 6 de tolerancia
		expect(hitTest(a, { x: 60, y: 40 })).toBe(false);
	});

	it("text: responde en toda su caja estimada", () => {
		const a = make(
			"t",
			"text",
			{ x: 10, y: 10 },
			{ x: 10, y: 10 },
			{ text: "hola mundo", stroke_width: 3 },
		);
		expect(hitTest(a, { x: 40, y: 20 })).toBe(true);
		expect(hitTest(a, { x: 500, y: 500 })).toBe(false);
	});
});

describe("findAnnotationAt y capas", () => {
	it("lista vacía: null", () => {
		expect(findAnnotationAt([], { x: 0, y: 0 })).toBeNull();
	});

	it("sin coincidencia: null", () => {
		expect(findAnnotationAt([rect("a")], { x: 500, y: 500 })).toBeNull();
	});

	it("con anotaciones superpuestas gana la de arriba (la última)", () => {
		const abajo = make("abajo", "mosaic", { x: 0, y: 0 }, { x: 100, y: 100 });
		const arriba = make("arriba", "mosaic", { x: 20, y: 20 }, { x: 80, y: 80 });
		expect(findAnnotationAt([abajo, arriba], { x: 50, y: 50 })).toBe("arriba");
		expect(findAnnotationAt([arriba, abajo], { x: 50, y: 50 })).toBe("abajo");
	});

	it("si la de arriba no toca el punto, cae a la de abajo", () => {
		const abajo = make("abajo", "mosaic", { x: 0, y: 0 }, { x: 100, y: 100 });
		const arriba = make(
			"arriba",
			"mosaic",
			{ x: 200, y: 200 },
			{ x: 300, y: 300 },
		);
		expect(findAnnotationAt([abajo, arriba], { x: 50, y: 50 })).toBe("abajo");
	});

	it("respeta la tolerancia recibida", () => {
		const a = rect("a");
		expect(findAnnotationAt([a], { x: -20, y: 25 })).toBeNull();
		expect(findAnnotationAt([a], { x: -20, y: 25 }, 30)).toBe("a");
	});
});

describe("removeAnnotationAt (borrador)", () => {
	it("sin coincidencia devuelve la misma referencia", () => {
		const h = addAnnotation(createHistory(), rect("a"));
		expect(removeAnnotationAt(h, { x: 500, y: 500 })).toBe(h);
	});

	it("sobre un historial vacío devuelve la misma referencia", () => {
		const h = createHistory();
		expect(removeAnnotationAt(h, { x: 0, y: 0 })).toBe(h);
	});

	it("borra solo la anotación superior bajo el punto", () => {
		let h = createHistory();
		h = addAnnotation(
			h,
			make("abajo", "mosaic", { x: 0, y: 0 }, { x: 100, y: 100 }),
		);
		h = addAnnotation(
			h,
			make("arriba", "mosaic", { x: 0, y: 0 }, { x: 100, y: 100 }),
		);
		h = removeAnnotationAt(h, { x: 50, y: 50 });
		expect(ids(h)).toEqual(["abajo"]);
	});

	it("el borrado se puede deshacer y rehacer", () => {
		let h = addAnnotation(createHistory(), rect("a"));
		h = addAnnotation(h, rect("b", 200, 200));
		h = removeAnnotationAt(h, { x: 0, y: 25 });
		expect(ids(h)).toEqual(["b"]);
		h = undo(h);
		expect(ids(h)).toEqual(["a", "b"]);
		h = redo(h);
		expect(ids(h)).toEqual(["b"]);
	});

	it("borrar descarta lo rehacible, como cualquier edición", () => {
		let h = createHistory();
		h = addAnnotation(h, rect("a"));
		h = addAnnotation(h, rect("b", 200, 200));
		h = undo(h);
		expect(canRedo(h)).toBe(true);
		h = removeAnnotationAt(h, { x: 0, y: 25 });
		expect(canRedo(h)).toBe(false);
	});

	it("un borrado fallido no ensucia el historial (no crea paso de deshacer)", () => {
		let h = addAnnotation(createHistory(), rect("a"));
		h = undo(h);
		const antes = h;
		h = removeAnnotationAt(h, { x: 0, y: 0 });
		expect(h).toBe(antes);
		expect(canRedo(h)).toBe(true);
	});

	it("rect: clic en el interior no lo borra, en el contorno sí", () => {
		const h = addAnnotation(createHistory(), rect("a"));
		expect(removeAnnotationAt(h, { x: 50, y: 25 })).toBe(h);
		expect(ids(removeAnnotationAt(h, { x: 0, y: 25 }))).toEqual([]);
	});
});

describe("textFontSize", () => {
	it("es stroke_width por 6", () => {
		expect(textFontSize(1)).toBe(6);
		expect(textFontSize(4)).toBe(24);
	});
});

describe("hitTest de elipse: tolerancia uniforme en todos los ejes", () => {
	// Elipse 100×60 con trazo 2 y tolerancia 6 → alcance de 7 px al contorno.
	const e = make("e", "ellipse", { x: 0, y: 0 }, { x: 100, y: 60 });

	it("a 10 px del contorno en el eje largo (X) no acierta", () => {
		expect(hitTest(e, { x: 110, y: 30 })).toBe(false);
		expect(hitTest(e, { x: -10, y: 30 })).toBe(false);
	});

	it("a 10 px del contorno en el eje corto (Y) no acierta", () => {
		expect(hitTest(e, { x: 50, y: 70 })).toBe(false);
		expect(hitTest(e, { x: 50, y: -10 })).toBe(false);
	});

	it("a 5 px del contorno acierta en ambos ejes", () => {
		expect(hitTest(e, { x: 105, y: 30 })).toBe(true);
		expect(hitTest(e, { x: 50, y: 65 })).toBe(true);
	});
});

describe("edición de anotaciones existentes (herramienta Seleccionar)", () => {
	const rect: Annotation = {
		id: "r",
		kind: "rect",
		color: "#f00",
		stroke_width: 4,
		start: { x: 10, y: 20 },
		end: { x: 50, y: 60 },
	};
	const arrow: Annotation = { ...rect, id: "a", kind: "arrow" };
	const pen: Annotation = {
		...rect,
		id: "p",
		kind: "pen",
		points: [
			{ x: 10, y: 20 },
			{ x: 30, y: 40 },
		],
	};
	const hist = (...present: Annotation[]): AnnotationHistory => ({
		past: [],
		present,
		future: [],
	});

	it("moveAnnotation desplaza start, end y puntos sin mutar", () => {
		const moved = moveAnnotation(pen, 5, -5);
		expect(moved.start).toEqual({ x: 15, y: 15 });
		expect(moved.points).toEqual([
			{ x: 15, y: 15 },
			{ x: 35, y: 35 },
		]);
		expect(pen.start).toEqual({ x: 10, y: 20 });
	});

	it("la flecha tiene dos asas y mover una deja la otra fija", () => {
		expect(annotationHandles(arrow).map((h) => h.id)).toEqual(["start", "end"]);
		const r = resizeAnnotationHandle(arrow, "end", { x: 99, y: 98 });
		expect(r.end).toEqual({ x: 99, y: 98 });
		expect(r.start).toEqual(arrow.start);
	});

	it("rect/elipse tienen ocho asas (esquinas y lados) y el borde opuesto queda fijo", () => {
		expect(annotationHandles(rect).map((h) => h.id)).toEqual([
			"nw",
			"ne",
			"sw",
			"se",
			"n",
			"e",
			"s",
			"w",
		]);
		const r = resizeAnnotationHandle(rect, "nw", { x: 0, y: 0 });
		expect(annotationBox(r)).toEqual({ x: 0, y: 0, width: 50, height: 60 });
		const s = resizeAnnotationHandle(rect, "se", { x: 100, y: 100 });
		expect(annotationBox(s)).toEqual({ x: 10, y: 20, width: 90, height: 80 });
	});

	it("arrastrar una esquina más allá de la opuesta voltea la caja", () => {
		const r = resizeAnnotationHandle(rect, "se", { x: 0, y: 0 });
		expect(annotationBox(r)).toEqual({ x: 0, y: 0, width: 10, height: 20 });
	});

	it("un asa de lado solo mueve su eje; ningún lado baja del mínimo", () => {
		const n = resizeAnnotationHandle(rect, "n", { x: 999, y: 5 });
		expect(annotationBox(n)).toEqual({ x: 10, y: 5, width: 40, height: 55 });
		const tiny = resizeAnnotationHandle(rect, "e", { x: 11, y: 40 });
		expect(annotationBox(tiny).width).toBe(MIN_ANNOTATION_SIZE);
		const flipped = resizeAnnotationHandle(rect, "se", { x: 12, y: 21 });
		expect(annotationBox(flipped)).toMatchObject({
			width: MIN_ANNOTATION_SIZE,
			height: MIN_ANNOTATION_SIZE,
		});
	});

	it("lápiz no tiene asas; un asa ajena devuelve la misma referencia", () => {
		expect(annotationHandles(pen)).toEqual([]);
		expect(resizeAnnotationHandle(pen, "nw", { x: 0, y: 0 })).toBe(pen);
		expect(resizeAnnotationHandle(arrow, "nw", { x: 0, y: 0 })).toBe(arrow);
	});

	it("findHandleAt acierta dentro de la tolerancia y falla fuera", () => {
		expect(findHandleAt(arrow, { x: 52, y: 62 })).toBe("end");
		expect(findHandleAt(arrow, { x: 200, y: 200 })).toBeNull();
	});

	it("replaceAnnotation, updateAnnotation y removeAnnotation son pasos deshacibles", () => {
		const h0 = hist(rect, arrow);
		const moved = replaceAnnotation(h0, moveAnnotation(rect, 1, 1));
		expect(moved.present[0].start).toEqual({ x: 11, y: 21 });
		expect(undo(moved).present[0]).toBe(rect);

		const recolored = updateAnnotation(h0, "r", { color: "#0f0" });
		expect(recolored.present[0].color).toBe("#0f0");
		expect(undo(recolored).present).toEqual(h0.present);

		const removed = removeAnnotation(h0, "a");
		expect(removed.present).toEqual([rect]);
		expect(undo(removed).present).toEqual([rect, arrow]);
		expect(redo(undo(removed)).present).toEqual([rect]);
	});

	it("mover 0,0 o llevar un asa a donde ya está devuelve la misma referencia", () => {
		expect(moveAnnotation(rect, 0, 0)).toBe(rect);
		expect(resizeAnnotationHandle(arrow, "end", { x: 50, y: 60 })).toBe(arrow);
		expect(resizeAnnotationHandle(rect, "se", { x: 50, y: 60 })).toBe(rect);
	});

	it("cambios nulos o ids desconocidos no ensucian el historial", () => {
		const h0 = hist(rect);
		expect(updateAnnotation(h0, "r", { color: "#f00" })).toBe(h0);
		expect(updateAnnotation(h0, "zz", { color: "#0f0" })).toBe(h0);
		expect(replaceAnnotation(h0, { ...rect, id: "zz" })).toBe(h0);
		expect(removeAnnotation(h0, "zz")).toBe(h0);
	});
});

describe("mosaico como pincel — edición", () => {
	const trazo: Annotation = {
		id: "m",
		kind: "mosaic",
		color: "#000000",
		stroke_width: 4,
		start: { x: 10, y: 10 },
		end: { x: 60, y: 10 },
		points: [
			{ x: 10, y: 10 },
			{ x: 60, y: 10 },
		],
	};

	it("no tiene asas: solo se mueve", () => {
		expect(annotationHandles(trazo)).toEqual([]);
		expect(resizeAnnotationHandle(trazo, "se", { x: 0, y: 0 })).toBe(trazo);
	});

	it("mover desplaza todo el recorrido", () => {
		const m = moveAnnotation(trazo, 5, 7);
		expect(m.points).toEqual([
			{ x: 15, y: 17 },
			{ x: 65, y: 17 },
		]);
		expect(trazo.points?.[0]).toEqual({ x: 10, y: 10 });
	});

	it("el borrador lo quita por donde pasó el trazo y se puede deshacer", () => {
		const h = addAnnotation(createHistory(), trazo);
		const r = removeAnnotationAt(h, { x: 35, y: 18 });
		expect(r.present).toEqual([]);
		expect(undo(r).present).toEqual([trazo]);
		expect(removeAnnotationAt(h, { x: 35, y: 80 })).toBe(h);
	});
});

describe("asas de la elipse: sobre el contorno, alcanzables como las del rectángulo", () => {
	const e = make("e", "ellipse", { x: 0, y: 0 }, { x: 100, y: 60 });

	it("cada asa cae sobre la curva (a la diagonal de su esquina), no en la esquina de la caja", () => {
		for (const h of annotationHandles(e)) {
			const f = ((h.point.x - 50) / 50) ** 2 + ((h.point.y - 30) / 30) ** 2;
			expect(f).toBeCloseTo(1, 6);
			expect(hitTest(e, h.point)).toBe(true);
		}
	});

	it("la esquina de la caja ya no es una asa, y la tolerancia de asa es la misma que en rect", () => {
		expect(findHandleAt(e, { x: 100, y: 60 })).toBeNull();
		const se = annotationHandles(e).find((h) => h.id === "se")?.point;
		expect(se && findHandleAt(e, { x: se.x + 7, y: se.y })).toBe("se");
	});

	it("llevar el asa diagonal la deja donde se soltó y deja fija la esquina opuesta", () => {
		const se = annotationHandles(e).find((h) => h.id === "se")?.point;
		if (!se) throw new Error("sin asa se");
		const to = { x: se.x + 20, y: se.y + 10 };
		const out = resizeAnnotationHandle(e, "se", to);
		const box = annotationBox(out);
		expect(box.x).toBe(0);
		expect(box.y).toBe(0);
		const moved = annotationHandles(out).find((h) => h.id === "se")?.point;
		expect(moved?.x).toBeCloseTo(to.x, 6);
		expect(moved?.y).toBeCloseTo(to.y, 6);
	});
});

describe("zona de las asas en figuras pequeñas", () => {
	const box = (side: number): Annotation =>
		make("r", "rect", { x: 100, y: 100 }, { x: 100 + side, y: 100 + side });

	it("en una figura grande el radio es el pedido; en una pequeña se encoge y deja trazo entre asas", () => {
		const big = box(200);
		expect(findHandleAt(big, { x: 100 + 14, y: 100 }, 14)).toBe("nw");
		const small = box(40);
		// radio ≤ 40/6 ≈ 6,7: a 10 px de la esquina, sobre el trazo, ya no es asa
		expect(findHandleAt(small, { x: 110, y: 100 }, 14)).toBeNull();
		expect(findHandleAt(small, { x: 106, y: 100 }, 14)).toBe("nw");
		expect(hitTest(small, { x: 110, y: 100 })).toBe(true);
	});

	it("de menos de 3 px por lado no tiene asas, ni en rect ni en elipse", () => {
		for (const kind of ["rect", "ellipse"] as const) {
			const tiny = make("t", kind, { x: 10, y: 10 }, { x: 12, y: 40 });
			expect(findHandleAt(tiny, { x: 10, y: 10 }, 14)).toBeNull();
		}
	});

	it("las flechas no se encogen: sus extremos conservan el radio pedido", () => {
		const arrow = make("a", "arrow", { x: 0, y: 0 }, { x: 5, y: 0 });
		expect(findHandleAt(arrow, { x: 0, y: 12 }, 14)).toBe("start");
	});
});

describe("texto: recuadro, reparto en líneas y manijas", () => {
	const text = (over: Partial<Annotation> = {}): Annotation => ({
		id: "t",
		kind: "text",
		color: "#fff",
		stroke_width: 4,
		start: { x: 100, y: 100 },
		end: { x: 100, y: 100 },
		text: "hola mundo",
		...over,
	});
	// stroke 4 → fuente 24 px; ancho estimado por carácter 14,4 px

	it("sin box_width la caja es la de la línea más larga; con box_width, el ancho es ese", () => {
		expect(annotationBox(text()).width).toBeCloseTo(10 * 14.4, 6);
		expect(annotationBox(text({ box_width: 100 })).width).toBe(100);
	});

	it("con box_width reparte por palabras y respeta los saltos propios", () => {
		// 100 px / 14,4 = 6 caracteres por línea
		expect(layoutText(text({ box_width: 100 }))).toEqual(["hola", "mundo"]);
		expect(layoutText(text({ box_width: 100, text: "a\n\nb" }))).toEqual([
			"a",
			"",
			"b",
		]);
	});

	it("parte una palabra más larga que la línea", () => {
		expect(layoutText(text({ box_width: 100, text: "abcdefghijklm" }))).toEqual(
			["abcdef", "ghijkl", "m"],
		);
	});

	it("el alto crece con las líneas repartidas", () => {
		const wide = annotationBox(text());
		const narrow = annotationBox(text({ box_width: 100 }));
		expect(narrow.height).toBeCloseTo(wide.height * 2, 6);
	});

	it("tiene seis manijas: esquinas y lados e/w, sin n/s", () => {
		expect(
			annotationHandles(text())
				.map((h) => h.id)
				.sort(),
		).toEqual(["e", "ne", "nw", "se", "sw", "w"]);
	});

	it("una esquina escala el tamaño de fuente en proporción y deja fija la opuesta", () => {
		const t = text({ box_width: 144 });
		const b = annotationBox(t);
		const se = annotationHandles(t).find((h) => h.id === "se")?.point;
		if (!se) throw new Error("sin asa se");
		// el doble en cada eje desde la esquina nw
		const out = resizeAnnotationHandle(t, "se", {
			x: b.x + 2 * b.width,
			y: b.y + 2 * b.height,
		});
		expect(out.font_size).toBeCloseTo(48, 6);
		expect(out.box_width).toBeCloseTo(288, 6);
		expect(out.start).toEqual({ x: 100, y: 100 });
		const after = annotationBox(out);
		expect(after.width).toBeCloseTo(2 * b.width, 6);
		expect(after.height).toBeCloseTo(2 * b.height, 6);
	});

	it("desde nw la esquina opuesta (se) se queda quieta", () => {
		const t = text({ box_width: 144 });
		const b = annotationBox(t);
		const out = resizeAnnotationHandle(t, "nw", {
			x: b.x + b.width / 2,
			y: b.y + b.height / 2,
		});
		const after = annotationBox(out);
		expect(out.font_size).toBeCloseTo(12, 6);
		expect(after.x + after.width).toBeCloseTo(b.x + b.width, 6);
		expect(after.y + after.height).toBeCloseTo(b.y + b.height, 6);
	});

	it("el tamaño de fuente no baja del mínimo ni sube del máximo", () => {
		const t = text();
		const b = annotationBox(t);
		const tiny = resizeAnnotationHandle(t, "se", { x: b.x + 1, y: b.y + 1 });
		expect(tiny.font_size).toBe(MIN_TEXT_FONT_SIZE);
		const huge = resizeAnnotationHandle(t, "se", {
			x: b.x + 1e6,
			y: b.y + 1e6,
		});
		expect(huge.font_size).toBe(MAX_TEXT_FONT_SIZE);
	});

	it("los lados e/w cambian solo el ancho del recuadro; la fuente no cambia y el otro borde queda quieto", () => {
		const t = text({ box_width: 200 });
		const e = resizeAnnotationHandle(t, "e", { x: 100 + 90, y: 110 });
		expect(e.box_width).toBe(90);
		expect(e.font_size).toBeUndefined();
		expect(e.start).toEqual({ x: 100, y: 100 });
		const w = resizeAnnotationHandle(t, "w", { x: 100 + 120, y: 110 });
		expect(w.box_width).toBe(80);
		expect(w.start.x).toBe(220);
	});

	it("el ancho del recuadro no baja de dos caracteres", () => {
		const out = resizeAnnotationHandle(text({ box_width: 200 }), "e", {
			x: 101,
			y: 110,
		});
		expect(out.box_width).toBeCloseTo(2 * 14.4, 6);
	});

	it("mover un texto conserva su tamaño y su ancho", () => {
		const m = moveAnnotation(text({ box_width: 100, font_size: 30 }), 5, 5);
		expect(m.box_width).toBe(100);
		expect(m.font_size).toBe(30);
	});

	it("updateAnnotation cambia el tamaño de fuente en un paso de historial", () => {
		const h = addAnnotation(createHistory(), text());
		const next = updateAnnotation(h, "t", { font_size: 48 });
		expect(next.present[0].font_size).toBe(48);
		expect(undo(next).present[0].font_size).toBeUndefined();
		expect(updateAnnotation(next, "t", { font_size: 48 })).toBe(next);
	});
});

describe("texto: escalar con las esquinas usa tamaños de fuente enteros", () => {
	it("cualquier posición del puntero da un font_size entero (una fuente nueva por evento sería muy cara de pintar)", () => {
		const t: Annotation = {
			id: "t",
			kind: "text",
			color: "#fff",
			stroke_width: 4,
			start: { x: 100, y: 100 },
			end: { x: 100, y: 100 },
			text: "hola mundo",
		};
		const b = annotationBox(t);
		for (let i = 1; i <= 50; i++) {
			const out = resizeAnnotationHandle(t, "se", {
				x: b.x + b.width * (0.3 + i * 0.0371),
				y: b.y + b.height * (0.3 + i * 0.0371),
			});
			expect(Number.isInteger(out.font_size)).toBe(true);
		}
	});
});

describe("newTextBox: el texto nuevo llega hasta el borde derecho del área menos el margen", () => {
	const area = { x: 100, w: 400 }; // borde derecho en 500; con el margen, 488
	const RIGHT = 500 - TEXT_RIGHT_MARGIN;
	// fuente 24 → 14,4 px por carácter → mínimo 8 caracteres = 115,2 px

	it("el margen es 12 px de imagen", () => {
		expect(TEXT_RIGHT_MARGIN).toBe(12);
	});

	it("lejos del borde, del punto de inserción al borde derecho menos el margen", () => {
		expect(newTextBox({ x: 150, y: 0 }, 24, area)).toEqual({
			x: 150,
			width: RIGHT - 150,
			right: RIGHT,
		});
	});

	it("justo en el mínimo se queda donde se hizo clic", () => {
		const at = RIGHT - 115.2;
		const box = newTextBox({ x: at, y: 0 }, 24, area);
		expect(box.x).toBe(at);
		expect(box.width).toBeCloseTo(115.2, 6);
	});

	it("cerca del borde derecho se ancla al borde con margen y el ancho mínimo", () => {
		const box = newTextBox({ x: 490, y: 0 }, 24, area);
		expect(box.width).toBeCloseTo(115.2, 6);
		expect(box.x + box.width).toBeCloseTo(RIGHT, 6);
	});

	it("clic fuera del borde derecho: nunca sale del área, ni toca el margen", () => {
		const out = newTextBox({ x: 700, y: 0 }, 24, area);
		expect(out.x + out.width).toBeLessThanOrEqual(RIGHT + 1e-9);
		expect(out.x).toBeGreaterThanOrEqual(100);
	});

	it("área estrecha: el margen se reduce hasta que el mínimo cabe (y es 0 si el área mide menos que el mínimo)", () => {
		// área de 120 px: mínimo 115,2 → margen = 4,8
		const a = newTextBox({ x: 110, y: 0 }, 24, { x: 100, w: 120 });
		expect(a.width).toBeCloseTo(115.2, 6);
		expect(a.right).toBeCloseTo(220 - 4.8, 6);
		// área de 60 px (menor que el mínimo): todo el ancho, sin margen
		expect(newTextBox({ x: 110, y: 0 }, 24, { x: 100, w: 60 })).toEqual({
			x: 100,
			width: 60,
			right: 160,
		});
	});

	it("el reparto resultante no pasa del recuadro, ni con palabras largas", () => {
		const box = newTextBox({ x: 150, y: 0 }, 24, area);
		const t: Annotation = {
			id: "t",
			kind: "text",
			color: "#fff",
			stroke_width: 4,
			start: { x: box.x, y: 0 },
			end: { x: box.x, y: 0 },
			text: `${"palabra ".repeat(30)}${"x".repeat(80)}`,
			box_width: box.width,
		};
		const lines = layoutText(t);
		expect(lines.length).toBeGreaterThan(3);
		for (const l of lines) {
			expect(l.length * 14.4).toBeLessThanOrEqual(box.width + 1e-9);
		}
	});
});

describe("límites del arrastre de un texto: el borde derecho no pasa de max_right", () => {
	const t: Annotation = {
		id: "t",
		kind: "text",
		color: "#fff",
		stroke_width: 4,
		start: { x: 100, y: 100 },
		end: { x: 100, y: 100 },
		text: "hola",
		max_right: 300,
	};

	it("el lado e se corta en max_right", () => {
		const out = resizeAnnotationHandle(t, "e", { x: 900, y: 110 });
		expect(out.box_width).toBe(200);
		expect(annotationBox(out).x + annotationBox(out).width).toBe(300);
	});

	it("la esquina se no escala más allá de max_right (ni siquiera redondeando)", () => {
		const b = annotationBox(t);
		const out = resizeAnnotationHandle(t, "se", {
			x: b.x + 50 * b.width,
			y: b.y + 50 * b.height,
		});
		const after = annotationBox(out);
		expect(after.x + after.width).toBeLessThanOrEqual(300 + 1e-9);
		expect(out.font_size).toBeGreaterThan(24);
	});

	it("los lados oeste no se ven limitados (su borde derecho queda fijo)", () => {
		const out = resizeAnnotationHandle({ ...t, box_width: 150 }, "w", {
			x: 60,
			y: 110,
		});
		expect(out.box_width).toBeCloseTo(190, 6);
		expect(out.start.x).toBe(60);
	});

	it("sin max_right (textos antiguos) no hay límite", () => {
		const { max_right: _quitado, ...viejo } = t;
		const out = resizeAnnotationHandle(viejo, "e", { x: 900, y: 110 });
		expect(out.box_width).toBe(800);
	});
});

describe("texto con ancho automático (max_right)", () => {
	const auto = (text: string): Annotation => ({
		id: "t",
		kind: "text",
		color: "#fff",
		stroke_width: 4,
		start: { x: 100, y: 100 },
		end: { x: 100, y: 100 },
		text,
		max_right: 400, // tope: 300 px = 20 caracteres de 14,4
	});

	it("el tope de reparto es lo que queda hasta max_right; un ancho fijo lo sustituye", () => {
		expect(textWrapWidth(auto("a"))).toBe(300);
		expect(textWrapWidth({ ...auto("a"), box_width: 90 })).toBe(90);
		expect(
			textWrapWidth({ ...auto("a"), max_right: undefined }),
		).toBeUndefined();
	});

	it("crece con el contenido en una línea y nunca pasa del tope", () => {
		expect(annotationBox(auto("hola")).width).toBeCloseTo(4 * 14.4, 6);
		expect(annotationBox(auto("hola mundo")).width).toBeCloseTo(10 * 14.4, 6);
		expect(layoutText(auto("hola mundo"))).toEqual(["hola mundo"]);
	});

	it("vacío o de un carácter: un recuadro mínimo de 2 caracteres, agarrable", () => {
		expect(annotationBox(auto("")).width).toBeCloseTo(2 * 14.4, 6);
		expect(annotationBox(auto("a")).width).toBeCloseTo(2 * 14.4, 6);
	});

	it("al llegar al tope baja de línea y el recuadro ocupa el tope entero (no se encoge al bajar una palabra)", () => {
		const text = "aaaa bbbb cccc dddd eeee";
		const lines = layoutText(auto(text));
		expect(lines.length).toBeGreaterThan(1);
		expect(annotationBox(auto(text)).width).toBe(300);
		expect(annotationBox(auto(text)).height).toBeCloseTo(
			lines.length * 24 * 1.2,
			6,
		);
	});

	it("los saltos manuales se respetan sin llegar al tope y no cuentan como reparto", () => {
		expect(layoutText(auto("uno\ndos"))).toEqual(["uno", "dos"]);
		expect(annotationBox(auto("uno\ndos")).width).toBeCloseTo(3 * 14.4, 6);
	});

	it("arrastrar e/w lo pasa a ancho FIJO y desde entonces manda box_width", () => {
		const t = auto("hola");
		const e = resizeAnnotationHandle(t, "e", { x: 100 + 200, y: 110 });
		expect(e.box_width).toBe(200);
		expect(textWrapWidth(e)).toBe(200);
	});

	it("una esquina escala la fuente y deja el ancho automático (sin box_width)", () => {
		const t = auto("hola");
		const b = annotationBox(t);
		const out = resizeAnnotationHandle(t, "se", {
			x: b.x + 2 * b.width,
			y: b.y + 2 * b.height,
		});
		expect(out.font_size).toBe(48);
		expect(out.box_width).toBeUndefined();
	});
});
