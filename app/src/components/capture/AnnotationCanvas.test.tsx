import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationCanvas } from "./AnnotationCanvas";
import {
	type Annotation,
	type AnnotationHistory,
	createHistory,
} from "./annotations";
import type { Rect } from "./selection";

/**
 * Una anotación ya presente: sin ninguna, AnnotationCanvas no tiene nada que
 * dibujar (el recorte real ya se ve de fondo a través del hueco de
 * SelectionFrame). Esta prueba agrupa el redibujado en sí, así que necesita
 * algo que sí deba dibujarse.
 */
function historyWithOneAnnotation(): AnnotationHistory {
	const annotation: Annotation = {
		id: "a",
		kind: "rect",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 0, y: 0 },
		end: { x: 10, y: 10 },
	};
	return { past: [], present: [annotation], future: [] };
}

afterEach(cleanup);

/** jsdom no implementa la Pointer Events API: stub de los tres métodos que usa el canvas. */
function mockPointerCapture() {
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}

/** Stub minimal de CanvasRenderingContext2D: solo lo que renderAnnotations.ts toca. */
function mockCanvasContext() {
	const ctx = {
		save: vi.fn(),
		restore: vi.fn(),
		translate: vi.fn(),
		drawImage: vi.fn(),
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		closePath: vi.fn(),
		stroke: vi.fn(),
		fill: vi.fn(),
		fillText: vi.fn(),
		fillRect: vi.fn(),
		strokeRect: vi.fn(),
		ellipse: vi.fn(),
		arc: vi.fn(),
		quadraticCurveTo: vi.fn(),
	} as unknown as CanvasRenderingContext2D;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
	return ctx;
}

/** Controla requestAnimationFrame: encola callbacks y los dispara a pedido. */
function mockRaf() {
	const callbacks: FrameRequestCallback[] = [];
	const spy = vi
		.spyOn(window, "requestAnimationFrame")
		.mockImplementation((cb: FrameRequestCallback) => {
			callbacks.push(cb);
			return callbacks.length;
		});
	return {
		spy,
		flush: () => {
			const pending = callbacks.splice(0, callbacks.length);
			for (const cb of pending) cb(0);
		},
	};
}

function frame(selection: Rect, history: AnnotationHistory) {
	return (
		<AnnotationCanvas
			image={new Image()}
			selection={selection}
			scale={{ x: 1, y: 1 }}
			tool={null}
			color="#000000"
			strokeWidth={4}
			history={history}
			onHistoryChange={() => {}}
		/>
	);
}

describe("AnnotationCanvas — trabajo por frame, no por evento", () => {
	// Reproduce el bug de la ronda B (selección lenta/parpadeo — "se traba" al
	// mover el recuadro o dibujar flecha/cuadrado): el redibujado corría una
	// vez por cada cambio de `selection`/`draft` dentro de un efecto síncrono,
	// así que N pointermove en el mismo frame producían N resets de
	// canvas.width/height + N dibujados. Ahora se agrupa con
	// requestAnimationFrame (ver useRafCallback). Se mide con strokeRect (lo
	// que pinta una anotación "rect"), no con drawImage: la vista previa en
	// vivo ya no dibuja el recorte de fondo (ver el otro `it` de este describe
	// y renderAnnotations.test.ts) — drawImage no se llama nunca acá.
	it("agrupa varios cambios de selección del mismo frame en un solo redibujado", () => {
		const ctx = mockCanvasContext();
		const raf = mockRaf();
		const history = historyWithOneAnnotation();
		const { rerender } = render(frame({ x: 0, y: 0, w: 100, h: 100 }, history));
		vi.mocked(ctx.strokeRect).mockClear();

		for (let i = 1; i <= 5; i++) {
			rerender(frame({ x: 0, y: 0, w: 100, h: 100 + i }, history));
		}
		expect(ctx.strokeRect).not.toHaveBeenCalled();

		raf.flush();
		expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
		expect(ctx.drawImage).not.toHaveBeenCalled();

		raf.spy.mockRestore();
	});

	// Hallazgo de QA (flujo de deshacer): si el historial pasa a vacío ANTES de
	// que corra el frame ya programado, el efecto limpia el canvas al instante
	// pero el frame pendiente sigue vivo y vuelve a pintar la figura de antes
	// (mantener Ctrl+Z pulsado, o dos deshacer en < 16 ms). Defecto abierto
	// (reportado): al corregirlo, `obsoleto = it.skip` → `it`.
	const obsoleto = it;
	obsoleto(
		"vaciar el historial antes del frame cancela el redibujado pendiente: no reaparece la figura",
		() => {
			const ctx = mockCanvasContext();
			const raf = mockRaf();
			const una = historyWithOneAnnotation();
			const vacia: AnnotationHistory = { past: [], present: [], future: [] };
			const { rerender } = render(frame({ x: 0, y: 0, w: 100, h: 100 }, una));
			raf.flush();
			vi.mocked(ctx.strokeRect).mockClear();

			// un cambio que programa un frame con la figura...
			rerender(frame({ x: 0, y: 0, w: 100, h: 101 }, una));
			// ...y antes de que corra, el historial se vacía
			rerender(frame({ x: 0, y: 0, w: 100, h: 101 }, vacia));
			raf.flush();
			expect(ctx.strokeRect).not.toHaveBeenCalled();

			raf.spy.mockRestore();
		},
	);

	it("sin anotaciones ni forma en curso, se salta el redibujado por completo", () => {
		const ctx = mockCanvasContext();
		const raf = mockRaf();
		const history: AnnotationHistory = { past: [], present: [], future: [] };
		const { rerender } = render(frame({ x: 0, y: 0, w: 100, h: 100 }, history));
		vi.mocked(ctx.drawImage).mockClear();

		for (let i = 1; i <= 5; i++) {
			rerender(frame({ x: 0, y: 0, w: 100, h: 100 + i }, history));
		}
		raf.flush();
		expect(ctx.drawImage).not.toHaveBeenCalled();

		raf.spy.mockRestore();
	});
});

/**
 * Bug reportado en la segunda ronda manual: tras soltar el botón, la flecha
 * (o el cuadrado, el círculo…) queda "atrapada" al puntero y exige OTRO clic
 * para fijarse — el gesto no termina con pointerup. El frontend lo arregla
 * con `setPointerCapture` + un respaldo de `pointerup` en `window` (F4). El
 * uso normal (soltar sobre el propio canvas) ya funciona hoy: `handleUp`
 * está cableado en `onPointerUp`/`onPointerCancel` del canvas. Lo que falta
 * es el caso en que el navegador no retarget-ea el evento al elemento con la
 * captura (el bug real en WebKitGTK) — ahí el canvas nunca recibe el
 * pointerup y el respaldo en `window` es lo que lo salva.
 */
function frameWithTool(
	tool: Parameters<typeof AnnotationCanvas>[0]["tool"],
	history: AnnotationHistory,
	onHistoryChange: (history: AnnotationHistory) => void,
) {
	return (
		<AnnotationCanvas
			image={new Image()}
			selection={{ x: 0, y: 0, w: 100, h: 100 }}
			scale={{ x: 1, y: 1 }}
			tool={tool}
			color="#000000"
			strokeWidth={4}
			history={history}
			onHistoryChange={onHistoryChange}
		/>
	);
}

describe("AnnotationCanvas — el gesto de dibujo termina solo con pointerup", () => {
	it("pointerdown, mover y soltar sobre el propio canvas commitea exactamente una anotación", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		const onHistoryChange = vi.fn();
		const { getByRole } = render(
			frameWithTool("pen", createHistory(), onHistoryChange),
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});

		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerMove(canvas, { pointerId: 1 });
		fireEvent.pointerUp(canvas, { pointerId: 1 });

		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		expect(onHistoryChange.mock.calls[0][0].present).toHaveLength(1);

		raf.spy.mockRestore();
	});

	it("un pointerup soltado fuera del canvas también termina el gesto, sin un segundo clic", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		const onHistoryChange = vi.fn();
		const { getByRole } = render(
			frameWithTool("pen", createHistory(), onHistoryChange),
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});

		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerMove(canvas, { pointerId: 1 });
		// El puntero se soltó fuera del canvas (p. ej. el navegador no
		// retarget-ea el evento al elemento con la captura, como en el bug
		// real de WebKitGTK) — debe llegar por el respaldo en `window`.
		fireEvent.pointerUp(window, { pointerId: 1 });

		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		expect(onHistoryChange.mock.calls[0]?.[0].present).toHaveLength(1);

		// Sin un segundo clic: el siguiente gesto arranca una anotación
		// nueva, no "rescata" ni reutiliza la anterior.
		fireEvent.pointerDown(canvas, { pointerId: 2, button: 0 });
		fireEvent.pointerUp(canvas, { pointerId: 2 });
		expect(onHistoryChange).toHaveBeenCalledTimes(2);

		raf.spy.mockRestore();
	});

	function setup(tool: Parameters<typeof frameWithTool>[0] = "rect") {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		const onHistoryChange = vi.fn();
		const view = render(frameWithTool(tool, createHistory(), onHistoryChange));
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		return { raf, onHistoryChange, canvas };
	}

	it("up seguido de lostpointercapture commitea una sola vez", () => {
		const { raf, onHistoryChange, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerUp(canvas, { pointerId: 1 });
		fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});

	it("lostpointercapture solo (sin pointerup) también cierra el gesto", () => {
		const { raf, onHistoryChange, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.lostPointerCapture(canvas, { pointerId: 1 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});

	it("pointercancel confirma lo dibujado (no lo descarta)", () => {
		const { raf, onHistoryChange, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerCancel(window, { pointerId: 1 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});

	it("una forma de arrastre mínimo (clic sin mover) no crea anotación", () => {
		const { raf, onHistoryChange, canvas } = setup("rect");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerUp(canvas, { pointerId: 1 });
		expect(onHistoryChange).not.toHaveBeenCalled();
		raf.spy.mockRestore();
	});

	it("si se perdió el pointerup, el siguiente clic cierra el gesto y no arma otro", () => {
		const { raf, onHistoryChange, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerDown(canvas, { pointerId: 2, button: 0 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		// Ese clic no abrió un gesto nuevo: soltar no commitea nada más.
		fireEvent.pointerUp(canvas, { pointerId: 2 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});

	it("el pointerup de otro puntero no cierra el gesto en curso", () => {
		const { raf, onHistoryChange, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerUp(window, { pointerId: 7 });
		expect(onHistoryChange).not.toHaveBeenCalled();
		fireEvent.pointerUp(window, { pointerId: 1 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});
});

describe("AnnotationCanvas — herramienta Seleccionar", () => {
	const rect: Annotation = {
		id: "a",
		kind: "rect",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 10, y: 10 },
		end: { x: 50, y: 50 },
	};
	const history: AnnotationHistory = { past: [], present: [rect], future: [] };

	function setup(selectedId: string | null = null) {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"getBoundingClientRect",
		).mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
		const onHistoryChange = vi.fn();
		const onSelect = vi.fn();
		const view = render(
			<AnnotationCanvas
				image={new Image()}
				selection={{ x: 0, y: 0, w: 100, h: 100 }}
				scale={{ x: 1, y: 1 }}
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
		return { raf, view, canvas, onHistoryChange, onSelect };
	}

	it("un clic sobre una anotación la selecciona sin tocar el historial", () => {
		const { raf, canvas, onHistoryChange, onSelect } = setup();
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 10,
			clientY: 30,
		});
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 10, clientY: 30 });
		expect(onSelect).toHaveBeenCalledWith("a");
		expect(onHistoryChange).not.toHaveBeenCalled();
		raf.spy.mockRestore();
	});

	it("un clic en vacío deselecciona", () => {
		const { raf, canvas, onSelect } = setup("a");
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 90,
			clientY: 90,
		});
		expect(onSelect).toHaveBeenCalledWith(null);
		raf.spy.mockRestore();
	});

	it("arrastrar mueve la anotación y commitea un solo paso al soltar", () => {
		const { raf, canvas, onHistoryChange } = setup("a");
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 22,
			clientY: 22,
		});
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 27, clientY: 25 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 32, clientY: 32 });
		expect(onHistoryChange).not.toHaveBeenCalled();
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 32, clientY: 32 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		const moved = onHistoryChange.mock.calls[0][0].present[0];
		expect(moved.start).toEqual({ x: 20, y: 20 });
		expect(moved.end).toEqual({ x: 60, y: 60 });
		raf.spy.mockRestore();
	});

	it("arrastrar una manija cambia la esquina y deja fija la opuesta", () => {
		const { raf, canvas, onHistoryChange } = setup("a");
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 50,
			clientY: 50,
		});
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 70, clientY: 80 });
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 70, clientY: 80 });
		const r = onHistoryChange.mock.calls[0][0].present[0];
		expect(r.start).toEqual({ x: 10, y: 10 });
		expect(r.end).toEqual({ x: 70, y: 80 });
		raf.spy.mockRestore();
	});

	it("muestra las ocho zonas de manija de la seleccionada", () => {
		const { raf, view } = setup("a");
		expect(
			view.container.querySelectorAll("[data-annotation-handle]"),
		).toHaveLength(8);
		raf.spy.mockRestore();
	});

	it("sin selección no hay marco", () => {
		const { raf, view } = setup(null);
		expect(
			view.container.querySelector("[data-testid=annotation-selection]"),
		).toBeNull();
		raf.spy.mockRestore();
	});
});

describe("AnnotationCanvas — Seleccionar: arrastrar y volver no es una edición", () => {
	it("mover y regresar al origen antes de soltar no commitea", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"getBoundingClientRect",
		).mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
		const rect: Annotation = {
			id: "a",
			kind: "rect",
			color: "#ff0000",
			stroke_width: 4,
			start: { x: 10, y: 10 },
			end: { x: 50, y: 50 },
		};
		const onHistoryChange = vi.fn();
		const { getByRole } = render(
			<AnnotationCanvas
				image={new Image()}
				selection={{ x: 0, y: 0, w: 100, h: 100 }}
				scale={{ x: 1, y: 1 }}
				tool="select"
				color="#000000"
				strokeWidth={4}
				history={{ past: [], present: [rect], future: [] }}
				onHistoryChange={onHistoryChange}
				selectedId="a"
				onSelect={() => {}}
			/>,
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 10,
			clientY: 30,
		});
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 10, clientY: 30 });
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 30 });
		expect(onHistoryChange).not.toHaveBeenCalled();
		raf.spy.mockRestore();
	});
});

describe("AnnotationCanvas — anti arrastre nativo", () => {
	it("el pointerdown del gesto se cancela (defaultPrevented)", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		const { getByRole } = render(
			frameWithTool("rect", createHistory(), vi.fn()),
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		expect(fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 })).toBe(
			false,
		);
		raf.spy.mockRestore();
	});
});

describe("AnnotationCanvas — cursor contextual", () => {
	const rect: Annotation = {
		id: "a",
		kind: "rect",
		color: "#ff0000",
		stroke_width: 4,
		start: { x: 10, y: 10 },
		end: { x: 50, y: 50 },
	};
	const history: AnnotationHistory = { past: [], present: [rect], future: [] };

	function setup(
		tool: Parameters<typeof frameWithTool>[0],
		selectedId: string | null = null,
	) {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"getBoundingClientRect",
		).mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
		const view = render(
			<AnnotationCanvas
				image={new Image()}
				selection={{ x: 0, y: 0, w: 100, h: 100 }}
				scale={{ x: 1, y: 1 }}
				tool={tool}
				color="#000000"
				strokeWidth={4}
				history={history}
				onHistoryChange={() => {}}
				selectedId={selectedId}
				onSelect={() => {}}
			/>,
		);
		const canvas = view.getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		}) as HTMLCanvasElement;
		return { raf, canvas };
	}

	it.each([
		["rect", "crosshair"],
		["ellipse", "crosshair"],
		["arrow", "crosshair"],
		["pen", "crosshair"],
		["mosaic", "crosshair"],
		["text", "text"],
		["eraser", "cell"],
	] as const)(
		"%s arranca con su cursor propio (respaldo %s)",
		(tool, fallback) => {
			const { raf, canvas } = setup(tool);
			expect(canvas.style.cursor).toContain("data:image/svg+xml");
			expect(canvas.style.cursor.endsWith(`, ${fallback}`)).toBe(true);
			raf.spy.mockRestore();
		},
	);

	it("Seleccionar conserva el cursor del sistema", () => {
		const { raf, canvas } = setup("select");
		expect(canvas.style.cursor).toBe("default");
		raf.spy.mockRestore();
	});

	it("Seleccionar: `grab` (manita) sobre una anotación y `default` en vacío, tras un frame y sin renders", () => {
		const { raf, canvas } = setup("select");
		// Sobre el trazo y fuera del alcance de cualquier manija (la figura es pequeña).
		fireEvent.pointerMove(canvas, { clientX: 22, clientY: 22 });
		expect(canvas.style.cursor).toBe("default");
		raf.flush();
		expect(canvas.style.cursor).toBe("grab");
		fireEvent.pointerMove(canvas, { clientX: 90, clientY: 90 });
		raf.flush();
		expect(canvas.style.cursor).toBe("default");
		raf.spy.mockRestore();
	});

	it("Seleccionar: cursor direccional sobre las manijas de la elegida", () => {
		const { raf, canvas } = setup("select", "a");
		fireEvent.pointerMove(canvas, { clientX: 50, clientY: 50 });
		raf.flush();
		expect(canvas.style.cursor).toBe("nwse-resize");
		fireEvent.pointerMove(canvas, { clientX: 50, clientY: 10 });
		raf.flush();
		expect(canvas.style.cursor).toBe("nesw-resize");
		raf.spy.mockRestore();
	});

	it("durante el gesto el cursor es `grabbing` también en el documento, y se libera al soltar", () => {
		const { raf, canvas } = setup("select", "a");
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 10,
			clientY: 30,
		});
		expect(canvas.style.cursor).toBe("grabbing");
		expect(document.documentElement.style.cursor).toBe("grabbing");
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 10, clientY: 30 });
		expect(document.documentElement.style.cursor).toBe("");
		expect(canvas.style.cursor).toBe("default");
		raf.spy.mockRestore();
	});

	it("dibujando, el cursor del gesto se mantiene en el documento", () => {
		const { raf, canvas } = setup("pen");
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 20,
			clientY: 20,
		});
		expect(document.documentElement.style.cursor).toContain(
			"data:image/svg+xml",
		);
		fireEvent.pointerUp(window, { pointerId: 1 });
		expect(document.documentElement.style.cursor).toBe("");
		raf.spy.mockRestore();
	});
});

describe("AnnotationCanvas — pincel de mosaico", () => {
	it("pintar con el mosaico guarda un trazo con puntos y el grosor como pincel, no un recuadro", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		vi.spyOn(
			HTMLCanvasElement.prototype,
			"getBoundingClientRect",
		).mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
		const onHistoryChange = vi.fn();
		const { getByRole } = render(
			<AnnotationCanvas
				image={new Image()}
				selection={{ x: 0, y: 0, w: 100, h: 100 }}
				scale={{ x: 1, y: 1 }}
				tool="mosaic"
				color="#000000"
				strokeWidth={8}
				history={createHistory()}
				onHistoryChange={onHistoryChange}
			/>,
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		fireEvent.pointerDown(canvas, {
			pointerId: 1,
			button: 0,
			clientX: 10,
			clientY: 10,
		});
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 30, clientY: 12 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 20 });
		fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 20 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		const a = onHistoryChange.mock.calls[0][0].present[0];
		expect(a.kind).toBe("mosaic");
		expect(a.stroke_width).toBe(8);
		expect(a.points).toHaveLength(3);
		expect(a.points[0]).toEqual({ x: 10, y: 10 });
		raf.spy.mockRestore();
	});

	it("un toque sin mover también pinta una celda (no se descarta como un recuadro mínimo)", () => {
		mockCanvasContext();
		mockPointerCapture();
		const raf = mockRaf();
		const onHistoryChange = vi.fn();
		const { getByRole } = render(
			frameWithTool("mosaic", createHistory(), onHistoryChange),
		);
		const canvas = getByRole("img", {
			name: "Vista previa de la selección con anotaciones",
		});
		fireEvent.pointerDown(canvas, { pointerId: 1, button: 0 });
		fireEvent.pointerUp(window, { pointerId: 1 });
		expect(onHistoryChange).toHaveBeenCalledTimes(1);
		raf.spy.mockRestore();
	});
});
