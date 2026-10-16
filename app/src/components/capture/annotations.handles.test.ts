import { describe, expect, it } from "vitest";
import {
	type Annotation,
	type AnnotationKind,
	addAnnotation,
	annotationBox,
	annotationHandles,
	createHistory,
	hitTest,
	MIN_ANNOTATION_SIZE,
	redo,
	replaceAnnotation,
	resizeAnnotationHandle,
	undo,
} from "./annotations";

/**
 * Paridad entre figuras cerradas: toda figura de caja (hoy rect y elipse; en
 * el futuro polígono, rombo…) debe ofrecer las MISMAS manijas, alcanzables
 * desde su trazo visible, y redimensionarse igual. Origen: con Seleccionar el
 * rectángulo se redimensionaba y la elipse no, y ningún test lo notó porque
 * cada uno probaba su figura aparte y siempre sobre la esquina de la caja
 * (que en la elipse queda en el aire, lejos de la línea dibujada).
 *
 * `FAMILIA` es exhaustivo (`Record<AnnotationKind, …>`): añadir un tipo nuevo
 * sin clasificarlo aquí no compila, y una figura cerrada nueva entra sola en
 * las comprobaciones de abajo.
 */
const FAMILIA: Record<AnnotationKind, "cerrada" | "flecha" | "trazo"> = {
	rect: "cerrada",
	ellipse: "cerrada",
	arrow: "flecha",
	pen: "trazo",
	text: "trazo",
	mosaic: "trazo",
};
const kindsOf = (f: "cerrada" | "flecha" | "trazo"): AnnotationKind[] =>
	(Object.keys(FAMILIA) as AnnotationKind[]).filter((k) => FAMILIA[k] === f);
const CERRADAS = kindsOf("cerrada");

const shape = (kind: AnnotationKind): Annotation => ({
	id: "x",
	kind,
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 100, y: 100 },
	end: { x: 300, y: 250 },
});

describe("toda figura cerrada tiene las mismas manijas que el rectángulo", () => {
	it("hay al menos rect y elipse en la familia (el test no es vacío)", () => {
		expect(CERRADAS).toEqual(expect.arrayContaining(["rect", "ellipse"]));
	});

	it.each(CERRADAS)(
		"%s: mismos ids y mismo número de manijas que rect",
		(kind) => {
			const ids = (k: AnnotationKind) =>
				annotationHandles(shape(k))
					.map((h) => h.id)
					.sort();
			expect(ids(kind)).toEqual(ids("rect"));
			expect(ids(kind).length).toBeGreaterThanOrEqual(4);
		},
	);

	// Una manija invisible solo se descubre pasando el puntero por la línea
	// dibujada: tiene que caer sobre el trazo, no en el aire.
	// (Defecto original: las manijas de la elipse estaban en las esquinas de su
	// caja, fuera de la curva; corregido.)
	function manijasSobreElTrazo(kind: AnnotationKind) {
		const f = shape(kind);
		for (const h of annotationHandles(f)) {
			expect(hitTest(f, h.point, 0), `${kind}/${h.id} en el aire`).toBe(true);
		}
	}
	it.each(CERRADAS)(
		"%s: cada manija cae sobre su trazo visible",
		manijasSobreElTrazo,
	);

	it.each(CERRADAS)(
		"%s: cada manija redimensiona con la opuesta fija",
		(kind) => {
			const f = shape(kind);
			const box = annotationBox(f);
			for (const h of annotationHandles(f)) {
				const to = { x: h.point.x + 30, y: h.point.y + 20 };
				const out = resizeAnnotationHandle(f, h.id, to);
				const after = annotationBox(out);
				expect(out, `${kind}/${h.id}`).not.toBe(f);
				expect(after.width !== box.width || after.height !== box.height).toBe(
					true,
				);
				// la manija arrastrada sigue donde se soltó, en los ejes que mueve
				// (n/s solo en Y, e/w solo en X)
				const moved = annotationHandles(out).find((m) => m.id === h.id)?.point;
				if (h.id !== "n" && h.id !== "s") {
					expect(moved?.x, `${kind}/${h.id}`).toBeCloseTo(to.x, 6);
				}
				if (h.id !== "e" && h.id !== "w") {
					expect(moved?.y, `${kind}/${h.id}`).toBeCloseTo(to.y, 6);
				}
			}
		},
	);

	it("rect y elipse dan exactamente la misma caja al redimensionar con cada manija de lado", () => {
		// En las esquinas la manija de la elipse está sobre la curva y la del
		// rect en la esquina: el mismo punto no da la misma caja (sí la manija suelta donde se pide).
		for (const h of annotationHandles(shape("rect")).filter((m) =>
			["n", "e", "s", "w"].includes(m.id),
		)) {
			const to = { x: h.point.x - 40, y: h.point.y + 25 };
			const r = annotationBox(resizeAnnotationHandle(shape("rect"), h.id, to));
			const e = annotationBox(
				resizeAnnotationHandle(shape("ellipse"), h.id, to),
			);
			expect(e, h.id).toEqual(r);
		}
	});
});

/**
 * Las dos relajaciones que introdujo frontend en d947593 son legítimas solo si
 * lo que dejan de comprobar queda cubierto por otra cosa: aquí, que el borde
 * opuesto (o los dos) queda quieto, que el eje que la manija no mueve no
 * cambia, y que la manija queda donde se soltó en los ejes que sí mueve.
 */
describe("redimensionar figuras cerradas: borde opuesto fijo, ejes ajenos intactos, lado mínimo", () => {
	const ids = ["nw", "ne", "sw", "se", "n", "e", "s", "w"] as const;
	const cases = CERRADAS.flatMap((k) => ids.map((id) => [k, id] as const));

	it.each(cases)(
		"%s/%s: el borde opuesto y el eje ajeno no se mueven",
		(kind, id) => {
			const f = shape(kind);
			const b = annotationBox(f);
			const h = annotationHandles(f).find((m) => m.id === id)?.point as {
				x: number;
				y: number;
			};
			// hacia dentro de la figura, sin cruzar el borde opuesto
			const dx = id.includes("e") ? -20 : id.includes("w") ? 20 : 0;
			const dy = id.includes("s") ? -15 : id.includes("n") ? 15 : 0;
			const a = annotationBox(
				resizeAnnotationHandle(f, id, { x: h.x + dx, y: h.y + dy }),
			);
			if (id.includes("e")) expect(a.x).toBeCloseTo(b.x, 6);
			if (id.includes("w")) expect(a.x + a.width).toBeCloseTo(b.x + b.width, 6);
			if (id.includes("s")) expect(a.y).toBeCloseTo(b.y, 6);
			if (id.includes("n"))
				expect(a.y + a.height).toBeCloseTo(b.y + b.height, 6);
			if (dx === 0) {
				expect(a.x).toBeCloseTo(b.x, 6);
				expect(a.width).toBeCloseTo(b.width, 6);
			}
			if (dy === 0) {
				expect(a.y).toBeCloseTo(b.y, 6);
				expect(a.height).toBeCloseTo(b.height, 6);
			}
			// y se redimensionó de verdad en el eje que mueve
			expect(a.width !== b.width || a.height !== b.height).toBe(true);
		},
	);

	it.each(cases)(
		"%s/%s: llevada al borde opuesto o más allá, ningún lado baja de MIN_ANNOTATION_SIZE",
		(kind, id) => {
			const f = shape(kind);
			const h = annotationHandles(f).find((m) => m.id === id)?.point as {
				x: number;
				y: number;
			};
			for (const target of [
				{ x: 200, y: 175 }, // el centro: lado nulo
				{ x: -500, y: -500 },
				{ x: 900, y: 900 },
				{ x: h.x, y: h.y + 0.001 },
			]) {
				const a = annotationBox(resizeAnnotationHandle(f, id, target));
				expect(
					a.width,
					`${kind}/${id}→${target.x},${target.y}`,
				).toBeGreaterThanOrEqual(MIN_ANNOTATION_SIZE);
				expect(a.height).toBeGreaterThanOrEqual(MIN_ANNOTATION_SIZE);
				expect(Number.isFinite(a.width) && Number.isFinite(a.height)).toBe(
					true,
				);
			}
		},
	);

	it.each(CERRADAS)(
		"%s: cruzar el borde opuesto voltea la figura sin deformarla",
		(kind) => {
			const f = shape(kind);
			const b = annotationBox(f); // 200×150
			const a = annotationBox(
				resizeAnnotationHandle(f, "e", { x: b.x - 60, y: 175 }),
			);
			expect(a.height).toBeCloseTo(b.height, 6);
			expect(a.x + a.width).toBeCloseTo(b.x, 6); // el borde izquierdo original pasó a ser el derecho
			expect(a.width).toBeCloseTo(60, 6);
		},
	);

	it.each(CERRADAS)(
		"%s: una edición es un paso de historial; deshacer y rehacer son exactos",
		(kind) => {
			const f = shape(kind);
			const h0 = addAnnotation(createHistory(), f);
			const handle = annotationHandles(f).find((m) => m.id === "se")?.point as {
				x: number;
				y: number;
			};
			const resized = resizeAnnotationHandle(f, "se", {
				x: handle.x - 30,
				y: handle.y - 20,
			});
			const h1 = replaceAnnotation(h0, resized);
			expect(h1.past).toHaveLength(h0.past.length + 1);
			expect(h1.present).toEqual([resized]);
			expect(undo(h1).present).toEqual([f]);
			expect(redo(undo(h1)).present).toEqual([resized]);
		},
	);
});
