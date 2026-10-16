import { describe, expect, it } from "vitest";
import { areaToImage, imageToArea } from "./viewTransform";

const AREA = { x: 120, y: 80, w: 400, h: 300 };

describe("viewTransform — imagen ↔ área", () => {
	it("el origen del área es el (0,0) local, con cualquier escala", () => {
		for (const s of [1, 0.5, 1.25, 2]) {
			expect(imageToArea({ x: 120, y: 80 }, AREA, { x: s, y: s })).toEqual({
				x: 0,
				y: 0,
			});
		}
	});

	it("un punto a la derecha/abajo del origen da coordenadas locales positivas (sin espejo)", () => {
		const p = imageToArea({ x: 170, y: 130 }, AREA, { x: 2, y: 4 });
		expect(p).toEqual({ x: 100, y: 200 });
		const q = imageToArea({ x: 180, y: 150 }, AREA, { x: 2, y: 4 });
		// Mover la figura +10,+20 en imagen mueve su asa +20,+80 en pantalla: mismo sentido.
		expect({ x: q.x - p.x, y: q.y - p.y }).toEqual({ x: 20, y: 80 });
	});

	it("ida y vuelta devuelve el punto, con área desplazada y escala distinta por eje", () => {
		const scale = { x: 0.75, y: 1.5 };
		const p = { x: 333, y: 217 };
		expect(areaToImage(imageToArea(p, AREA, scale), AREA, scale)).toEqual(p);
	});
});
