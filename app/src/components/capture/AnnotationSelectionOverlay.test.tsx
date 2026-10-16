import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AnnotationSelectionOverlay } from "./AnnotationSelectionOverlay";
import { type Annotation, moveAnnotation } from "./annotations";

afterEach(cleanup);

/**
 * Zonas sensibles de la figura elegida: posición en pantalla respecto al área
 * (desplazada y escalada) y tamaño cómodo.
 *
 * Los tests `bug(...)` fijaron el defecto (rojo contra 5633647 + 55aa4bb);
 * ya están activos tras el arreglo.
 */
const bug = it;

/**
 * Cambio de diseño decidido por el usuario tras probar 6b8e370: la figura
 * seleccionada NO muestra recuadro punteado ni manijas (transparente). El modo
 * edición lo indica el cursor. Las zonas sensibles siguen existiendo como
 * elementos `[data-annotation-handle]` (invisibles, centrados en el punto de la
 * manija, de al menos 12 px de lado) dentro de `[data-testid=annotation-selection]`.
 * Los tests `diseno(...)` fijan ese contrato; activar al publicar el frontend
 * cambiando `diseno = it.skip` por `it`.
 */
const diseno = it;

// Área de captura desplazada (no empieza en 0,0) y escalada con ejes distintos:
// atrapa tanto un origen mal restado como un eje intercambiado.
const SELECTION = { x: 200, y: 100, w: 400, h: 300 };
const SCALE = { x: 0.5, y: 0.75 };

const RECT: Annotation = {
	id: "a",
	kind: "rect",
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 250, y: 150 },
	end: { x: 450, y: 300 },
};
const ARROW: Annotation = {
	id: "b",
	kind: "arrow",
	color: "#ff0000",
	stroke_width: 4,
	start: { x: 260, y: 140 },
	end: { x: 500, y: 360 },
};
function mount(annotation: Annotation, selection = SELECTION, scale = SCALE) {
	// Equivale al contenedor de AnnotationCanvas: caja del área, en coordenadas de pantalla.
	const view = render(
		<div
			data-testid="area"
			className="absolute"
			style={{
				left: selection.x * scale.x,
				top: selection.y * scale.y,
				width: selection.w * scale.x,
				height: selection.h * scale.y,
			}}
		>
			<canvas className="block h-full w-full" />
			<AnnotationSelectionOverlay
				annotation={annotation}
				selection={selection}
				scale={scale}
			/>
		</div>,
	);
	const root = view.getByTestId("annotation-selection");
	const marco = root.querySelector<HTMLElement>(".border-dashed");
	const manijas = Object.fromEntries(
		[...root.querySelectorAll<HTMLElement>("[data-annotation-handle]")].map(
			(h) => [h.dataset.annotationHandle as string, h],
		),
	);
	return { ...view, root, marco, manijas };
}

const px = (v: string) => Number.parseFloat(v);

describe("AnnotationSelectionOverlay — transformación imagen → pantalla", () => {
	it("las cuatro manijas de un rectángulo están en sus esquinas, en pantalla", () => {
		const { manijas } = mount(RECT);
		const at = (id: string) => [
			px(manijas[id].style.left),
			px(manijas[id].style.top),
		];
		expect(at("nw")).toEqual([25, 37.5]);
		expect(at("ne")).toEqual([125, 37.5]);
		expect(at("sw")).toEqual([25, 150]);
		expect(at("se")).toEqual([125, 150]);
	});

	it("las dos manijas de una flecha están en sus extremos, en pantalla", () => {
		const { manijas } = mount(ARROW);
		expect(Object.keys(manijas).sort()).toEqual(["end", "start"]);
		expect([px(manijas.start.style.left), px(manijas.start.style.top)]).toEqual(
			[30, 30],
		);
		expect([px(manijas.end.style.left), px(manijas.end.style.top)]).toEqual([
			150, 195,
		]);
	});

	it("sin espejo: mover la figura a la derecha y abajo mueve las zonas en el mismo sentido", () => {
		const before = mount(ARROW);
		const b = {
			sx: px(before.manijas.start.style.left),
			sy: px(before.manijas.start.style.top),
		};
		cleanup();
		const after = mount(moveAnnotation(ARROW, 40, 20));
		expect(px(after.manijas.start.style.left) - b.sx).toBeCloseTo(40 * 0.5);
		expect(px(after.manijas.start.style.top) - b.sy).toBeCloseTo(20 * 0.75);
	});

	it("la posición solo depende de la figura menos el origen del área (misma figura, otra área)", () => {
		const a = mount(RECT, SELECTION, SCALE);
		const left = px(a.manijas.nw.style.left);
		cleanup();
		// Área corrida 40 px de imagen a la derecha: la zona se corre -40·escala dentro de ella.
		const b = mount(RECT, { ...SELECTION, x: SELECTION.x + 40 }, SCALE);
		expect(px(b.manijas.nw.style.left)).toBeCloseTo(left - 40 * SCALE.x);
	});
});

describe("AnnotationSelectionOverlay — sin marco ni manijas visibles; zonas sensibles cómodas", () => {
	const sizePx = (el: HTMLElement, axis: "w" | "h") => {
		const inline = Number.parseFloat(
			axis === "w" ? el.style.width : el.style.height,
		);
		if (!Number.isNaN(inline)) return inline;
		const size = /(^|\s)size-(\d+(?:\.\d+)?)(\s|$)/.exec(el.className);
		if (size) return Number(size[2]) * 4;
		const m = new RegExp(
			`(^|\\s)${axis === "w" ? "w" : "h"}-(\\d+(?:\\.\\d+)?)(\\s|$)`,
		).exec(el.className);
		return m ? Number(m[2]) * 4 : 0;
	};
	const invisible = (el: HTMLElement) =>
		/(^|\s)opacity-0(\s|$)/.test(el.className) ||
		/(^|\s)bg-transparent(\s|$)/.test(el.className) ||
		el.style.opacity === "0" ||
		el.style.visibility === "hidden" ||
		el.style.backgroundColor === "transparent";

	diseno("no hay recuadro punteado", () => {
		for (const a of [RECT, ARROW]) {
			cleanup();
			const { root } = mount(a);
			expect(root.querySelector(".border-dashed")).toBeNull();
			expect(root.innerHTML).not.toMatch(
				/border-dashed|border-\[var\(--color-accent\)\]/,
			);
		}
	});

	diseno(
		"las zonas sensibles son transparentes: ninguna pinta relleno ni borde de acento",
		() => {
			for (const a of [RECT, ARROW]) {
				cleanup();
				const { manijas } = mount(a);
				expect(Object.keys(manijas).length).toBeGreaterThan(0);
				for (const m of Object.values(manijas)) {
					expect(m.className).not.toMatch(/bg-\[var\(--color-accent/);
					expect(m.className).not.toMatch(/(^|\s)border(\s|-)/);
					expect(invisible(m) || !/bg-/.test(m.className)).toBe(true);
				}
			}
		},
	);

	diseno("cada zona sensible mide al menos 12×12 px de pantalla", () => {
		for (const a of [RECT, ARROW]) {
			cleanup();
			const { manijas } = mount(a);
			for (const m of Object.values(manijas)) {
				expect(sizePx(m, "w")).toBeGreaterThanOrEqual(12);
				expect(sizePx(m, "h")).toBeGreaterThanOrEqual(12);
			}
		}
	});
});

describe("AnnotationSelectionOverlay — dentro del área de captura (criterio 4)", () => {
	// jsdom no calcula layout: se comprueba el contrato CSS que lo garantiza.
	// Un hijo `absolute` sin left/top toma su posición ESTÁTICA, es decir, debajo
	// del canvas (que es `block`): el marco queda desplazado una altura de área
	// hacia abajo, fuera de la captura. Verificado en Chrome real: con el área
	// en (100,100) 400×300 y una manija en (50,50) del área, su
	// getBoundingClientRect da (150,450) en vez de (150,150).
	function chain(el: HTMLElement, stop: HTMLElement) {
		const out: HTMLElement[] = [];
		for (let n: HTMLElement | null = el; n && n !== stop; n = n.parentElement) {
			out.push(n);
		}
		return out;
	}
	const has = (el: HTMLElement, re: RegExp) => re.test(el.className);
	const anchored = (el: HTMLElement) =>
		has(el, /(^|\s)inset-0(\s|$)/) ||
		(has(el, /(^|\s)left-0(\s|$)/) && has(el, /(^|\s)top-0(\s|$)/)) ||
		(el.style.left !== "" && el.style.top !== "");
	const sized = (el: HTMLElement) =>
		has(el, /(^|\s)inset-0(\s|$)/) ||
		has(el, /(^|\s)size-full(\s|$)/) ||
		(has(el, /(^|\s)w-full(\s|$)/) && has(el, /(^|\s)h-full(\s|$)/)) ||
		(el.style.width !== "" && el.style.height !== "");
	const clips = (el: HTMLElement) =>
		has(el, /(^|\s)overflow-(hidden|clip)(\s|$)/) ||
		["hidden", "clip"].includes(el.style.overflow);

	bug(
		"el contenedor del marco está anclado a la esquina del área, no a su posición estática",
		() => {
			const { root, getByTestId } = mount(RECT);
			const area = getByTestId("area");
			const absolutos = chain(root, area).filter((n) =>
				has(n, /(^|\s)absolute(\s|$)/),
			);
			expect(absolutos.length).toBeGreaterThan(0);
			for (const n of absolutos) {
				// El marco y las manijas se colocan con left/top propios; su
				// contenedor, si es absoluto, debe tener origen explícito.
				if (n.dataset.annotationHandle || has(n, /border-dashed/)) continue;
				expect(anchored(n), `contenedor sin left/top: ${n.className}`).toBe(
					true,
				);
			}
		},
	);

	bug(
		"el marco se recorta al área: ni el marco ni las manijas se dibujan fuera de la captura",
		() => {
			// Figura que sobresale por la izquierda y arriba del área (permitido: el
			// área se puede reducir tras dibujar).
			const fuera = moveAnnotation(RECT, -120, -90);
			const { root, getByTestId } = mount(fuera);
			const area = getByTestId("area");
			const recorta = chain(root, area).some(
				(n) => clips(n) && anchored(n) && sized(n),
			);
			expect(recorta, "ningún contenedor recorta al tamaño del área").toBe(
				true,
			);
		},
	);
});

describe("AnnotationSelectionOverlay — el texto elegido muestra sus seis manijas", () => {
	const TEXT: Annotation = {
		id: "t",
		kind: "text",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 250, y: 150 },
		end: { x: 250, y: 150 },
		text: "hola mundo",
		box_width: 200,
	};

	it("hay un punto visible en cada una de las seis manijas (4 esquinas y e/w), sin recibir eventos", () => {
		const { root, manijas } = mount(TEXT);
		expect(Object.keys(manijas).sort()).toEqual([
			"e",
			"ne",
			"nw",
			"se",
			"sw",
			"w",
		]);
		const marks = root.querySelectorAll("[data-handle-marker]");
		expect(marks).toHaveLength(6);
		expect(root.className).toContain("pointer-events-none");
	});

	it("las demás figuras siguen sin puntos visibles (se encuentran por la línea)", () => {
		const { root } = mount(RECT);
		expect(root.querySelectorAll("[data-handle-marker]")).toHaveLength(0);
	});
});

describe("AnnotationSelectionOverlay — recuadro punteado del texto elegido", () => {
	const TEXT: Annotation = {
		id: "t",
		kind: "text",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 250, y: 150 },
		end: { x: 250, y: 150 },
		text: "hola",
		box_width: 200,
	};

	it("el recuadro coincide con la caja del texto (ancho real del recuadro), en pantalla", () => {
		const { root } = mount(TEXT);
		const frame = root.querySelector<HTMLElement>("[data-text-frame]");
		expect(frame).not.toBeNull();
		// (250−200)·0,5 = 25 ; (150−100)·0,75 = 37,5 ; ancho 200·0,5 = 100 ; alto 28,8·0,75 = 21,6
		expect(px(frame?.style.left ?? "")).toBeCloseTo(25);
		expect(px(frame?.style.top ?? "")).toBeCloseTo(37.5);
		expect(px(frame?.style.width ?? "")).toBeCloseTo(100);
		expect(px(frame?.style.height ?? "")).toBeCloseTo(21.6);
	});

	it("mismo borde que el campo de edición: punteado, de acento, 1 px, sin sombra, sin recibir eventos", () => {
		const { root } = mount(TEXT);
		const frame = root.querySelector<HTMLElement>("[data-text-frame]");
		expect(frame?.className).toContain("border-dashed");
		expect(frame?.className).toContain("border-[var(--color-accent)]");
		expect(frame?.className).not.toMatch(/shadow/);
		expect(root.className).toContain("pointer-events-none");
	});

	it("sigue el ancho nuevo cuando la anotación cambia (durante el arrastre de una manija)", () => {
		const view = mount(TEXT);
		const before = px(
			view.root.querySelector<HTMLElement>("[data-text-frame]")?.style.width ??
				"",
		);
		cleanup();
		const after = mount({ ...TEXT, box_width: 320 });
		expect(
			px(
				after.root.querySelector<HTMLElement>("[data-text-frame]")?.style
					.width ?? "",
			),
		).toBeGreaterThan(before);
	});

	it("rectángulo y flecha no tienen recuadro punteado", () => {
		expect(mount(RECT).root.querySelector("[data-text-frame]")).toBeNull();
		cleanup();
		expect(mount(ARROW).root.querySelector("[data-text-frame]")).toBeNull();
	});
});
