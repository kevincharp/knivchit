import { describe, expect, it } from "vitest";
import {
	type Annotation,
	annotationBox,
	annotationFontSize,
	annotationHandles,
	layoutText,
	resizeAnnotationHandle,
} from "./annotations";

/**
 * Contrato del ancho automático del texto (frontend, 9f5629d): sin `box_width`
 * el ancho es automático y se parte a (`max_right` − `start.x`, mínimo 2
 * caracteres); el recuadro mide la línea más ancha mientras quepa una línea por
 * párrafo y el tope entero en cuanto haya que bajar de línea; `box_width` (lo
 * fijan las manijas e/w) manda sobre `max_right`; las esquinas escalan la
 * fuente y dejan el ancho automático. jsdom no mide texto: el reparto usa la
 * estimación de 0,6 em por carácter, suficiente para el contrato geométrico.
 */
const EM = 0.6;
const SIZE = 20;
const CHAR = SIZE * EM; // 12 px por carácter

const texto = (over: Partial<Annotation> = {}): Annotation => ({
	id: "t",
	kind: "text",
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 100, y: 50 },
	end: { x: 100, y: 50 },
	text: "hola",
	font_size: SIZE,
	max_right: 400,
	...over,
});

const LARGO =
	"una frase bastante larga que no cabe en una sola línea del área de captura y debe partirse sola";

describe("texto con ancho automático (max_right, sin box_width)", () => {
	it("un texto corto no se parte y su recuadro mide la línea, no el tope", () => {
		const a = texto();
		expect(layoutText(a)).toEqual(["hola"]);
		const b = annotationBox(a);
		expect(b.width).toBeLessThan(400 - 100);
		expect(b.width).toBeGreaterThan(0);
	});

	it("un texto largo se parte, ninguna línea pasa del tope y el recuadro ocupa el tope entero", () => {
		const a = texto({ text: LARGO });
		const lines = layoutText(a);
		expect(lines.length).toBeGreaterThan(1);
		for (const l of lines) {
			expect(l.length * CHAR, `«${l}»`).toBeLessThanOrEqual(300 + 1e-6);
		}
		expect(annotationBox(a).width).toBeCloseTo(300, 6);
		// no se pierde ni se inventa texto
		expect(lines.join(" ").replace(/\s+/g, " ").trim()).toBe(LARGO);
	});

	it("sin max_right ni box_width no se parte (comportamiento de siempre)", () => {
		const a = texto({ text: LARGO, max_right: undefined });
		expect(layoutText(a)).toEqual([LARGO]);
	});

	it("box_width fijo manda sobre max_right", () => {
		const a = texto({ text: LARGO, box_width: 150 });
		expect(annotationBox(a).width).toBeCloseTo(150, 6);
		for (const l of layoutText(a))
			expect(l.length * CHAR).toBeLessThanOrEqual(150 + 1e-6);
	});

	it("un tope minúsculo no se cuelga ni pierde texto: al menos 2 caracteres por línea", () => {
		const a = texto({ text: "abcdefgh ij", max_right: 101 });
		const lines = layoutText(a);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((l) => l.length >= 1)).toBe(true);
		expect(lines.join("").replace(/\s+/g, "")).toBe("abcdefghij");
		expect(annotationBox(a).width).toBeGreaterThanOrEqual(2 * CHAR - 1e-6);
	});

	it("texto vacío o de 1 carácter: recuadro de 2 caracteres", () => {
		for (const t of ["", "a"]) {
			expect(annotationBox(texto({ text: t })).width).toBeCloseTo(2 * CHAR, 6);
		}
	});

	it("los saltos de línea explícitos se respetan y cada párrafo se reparte aparte", () => {
		const a = texto({ text: `uno\n${LARGO}\ntres` });
		const lines = layoutText(a);
		expect(lines[0]).toBe("uno");
		expect(lines[lines.length - 1]).toBe("tres");
		expect(lines.length).toBeGreaterThan(3);
	});
});

describe("manijas del texto con ancho automático", () => {
	const manija = (a: Annotation, id: string) =>
		annotationHandles(a).find((h) => h.id === id)?.point as {
			x: number;
			y: number;
		};

	it("mover e/w fija box_width y deja de depender de max_right", () => {
		const a = texto({ text: LARGO });
		const p = manija(a, "e");
		const out = resizeAnnotationHandle(a, "e", { x: p.x - 100, y: p.y });
		expect(out.box_width).toBeDefined();
		expect(annotationBox(out).width).toBeCloseTo(200, 3);
		// cambiar max_right ya no cambia nada
		expect(annotationBox({ ...out, max_right: 900 }).width).toBeCloseTo(200, 3);
	});

	it("una esquina escala la fuente y deja el ancho automático", () => {
		const a = texto({ text: LARGO });
		const p = manija(a, "se");
		// hacia dentro: hacia fuera el borde derecho toparía con max_right (ver annotations.test.ts)
		const out = resizeAnnotationHandle(a, "se", { x: p.x - 30, y: p.y - 20 });
		expect(out.box_width).toBeUndefined();
		expect(annotationFontSize(out)).not.toBe(annotationFontSize(a));
		expect(out.max_right).toBe(a.max_right);
	});
});
