import { describe, expect, it } from "vitest";
import {
	clampRect,
	moveRect,
	placeToolbar,
	rectFromPoints,
	resizeRect,
} from "./selection";

const bounds = { w: 1000, h: 500 };

describe("selección", () => {
	it("normaliza un arrastre hacia arriba y la izquierda", () => {
		expect(rectFromPoints({ x: 50, y: 60 }, { x: 10, y: 20 })).toEqual({
			x: 10,
			y: 20,
			w: 40,
			h: 40,
		});
	});

	it("clampRect redondea y recorta a la imagen", () => {
		expect(clampRect({ x: -5, y: 10.4, w: 2000, h: 20.2 }, bounds)).toEqual({
			x: 0,
			y: 10,
			w: 1000,
			h: 21,
		});
	});

	it("mover se detiene en los bordes sin cambiar el tamaño", () => {
		const r = { x: 900, y: 10, w: 80, h: 40 };
		expect(moveRect(r, 500, -100, bounds)).toEqual({
			x: 920,
			y: 0,
			w: 80,
			h: 40,
		});
	});

	it("redimensionar con la manija se mueve solo en su eje", () => {
		const r = { x: 100, y: 100, w: 200, h: 100 };
		expect(resizeRect(r, "e", 50, 99, bounds)).toEqual({
			x: 100,
			y: 100,
			w: 250,
			h: 100,
		});
		expect(resizeRect(r, "nw", -20, -30, bounds)).toEqual({
			x: 80,
			y: 70,
			w: 220,
			h: 130,
		});
	});

	it("redimensionar respeta el mínimo y no voltea", () => {
		const r = { x: 100, y: 100, w: 200, h: 100 };
		const out = resizeRect(r, "w", 500, 0, bounds, 8);
		expect(out).toEqual({ x: 292, y: 100, w: 8, h: 100 });
	});

	it("redimensionar no sale de la imagen", () => {
		const r = { x: 900, y: 400, w: 90, h: 90 };
		expect(resizeRect(r, "se", 500, 500, bounds)).toEqual({
			x: 900,
			y: 400,
			w: 100,
			h: 100,
		});
	});

	it.each([
		["nw", { x: 205, y: 155, w: 295, h: 195 }],
		["n", { x: 200, y: 155, w: 300, h: 195 }],
		["ne", { x: 200, y: 155, w: 305, h: 195 }],
		["e", { x: 200, y: 150, w: 305, h: 200 }],
		["se", { x: 200, y: 150, w: 305, h: 205 }],
		["s", { x: 200, y: 150, w: 300, h: 205 }],
		["sw", { x: 205, y: 150, w: 295, h: 205 }],
		["w", { x: 205, y: 150, w: 295, h: 200 }],
	] as const)(
		"la manija %s solo mueve los bordes que toca",
		(handle, expected) => {
			const r = { x: 200, y: 150, w: 300, h: 200 };
			expect(resizeRect(r, handle, 5, 5, bounds)).toEqual(expected);
		},
	);

	it("mover nunca cambia el tamaño, ni siquiera cerca de los bordes", () => {
		const origin = { x: 400, y: 300, w: 300, h: 200 };
		for (const [dx, dy] of [
			[1, 0],
			[2, 0],
			[3, 1],
			[-200, -150],
			[5000, 5000],
		] as const) {
			const next = moveRect(origin, dx, dy, bounds);
			expect(next.w).toBe(origin.w);
			expect(next.h).toBe(origin.h);
			expect(next.w).not.toBe(bounds.w);
			expect(next.h).not.toBe(bounds.h);
		}
	});

	it("redimensionar con deltas crecientes cambia el tamaño de forma continua, sin saltos al tamaño de la imagen", () => {
		const origin = { x: 400, y: 300, w: 300, h: 200 };
		const widths = [1, 2, 3, 4, 5].map(
			(dx) => resizeRect(origin, "e", dx, 0, bounds).w,
		);
		expect(widths).toEqual([301, 302, 303, 304, 305]);
		for (const w of widths) expect(w).toBeLessThan(bounds.w);
	});

	it("un evento intermedio de arrastre nunca produce un rectángulo del tamaño de la pantalla", () => {
		// Reproduce el reporte de la ronda B: durante un arrastre, cada paso parte
		// siempre del rect original (`origin`), nunca se acumula sobre el resultado
		// anterior — así que un evento con dx/dy grande no puede "heredar" un salto.
		const origin = { x: 400, y: 300, w: 300, h: 200 };
		const steps = [10, 600, 15, -700, 20];
		for (const dx of steps) {
			const moved = moveRect(origin, dx, 0, bounds);
			expect(moved.w).toBe(origin.w);
			const resized = resizeRect(origin, "e", dx, 0, bounds);
			expect(resized.w).toBeLessThanOrEqual(bounds.w);
			expect(resized.h).toBe(origin.h);
		}
	});
});

describe("posición de la píldora", () => {
	const toolbar = { w: 400, h: 44 };
	const viewport = { w: 1920, h: 1080 };

	it("va debajo y centrada cuando cabe", () => {
		const p = placeToolbar(
			{ x: 100, y: 100, w: 600, h: 300 },
			toolbar,
			viewport,
		);
		expect(p).toEqual({ left: 400, top: 414, placement: "below" });
	});

	it("va encima si abajo no cabe", () => {
		const p = placeToolbar(
			{ x: 100, y: 500, w: 600, h: 560 },
			toolbar,
			viewport,
		);
		expect(p.placement).toBe("above");
		expect(p.top).toBe(500 - 14 - 44);
	});

	it("va dentro si ni arriba ni abajo caben", () => {
		const p = placeToolbar({ x: 0, y: 0, w: 1920, h: 1080 }, toolbar, viewport);
		expect(p.placement).toBe("inside");
	});

	it("no se sale por los costados", () => {
		const p = placeToolbar({ x: 0, y: 100, w: 40, h: 40 }, toolbar, viewport);
		expect(p.left).toBe(208);
	});
});
