import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const close = vi.fn();
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({ close }),
}));
vi.mock("../../lib/tauri", () => ({
	copyCapture: vi.fn(),
	saveCapture: vi.fn(),
	saveCaptureAs: vi.fn(),
	pinCapture: vi.fn(),
}));
vi.mock("./renderAnnotations", () => ({ composeCapture: vi.fn() }));

import {
	copyCapture,
	pinCapture,
	saveCapture,
	saveCaptureAs,
} from "../../lib/tauri";
import { composeCapture } from "./renderAnnotations";
import { useCaptureOutput } from "./useCaptureOutput";

const PNG = new Uint8Array([1, 2, 3]);
const image = {} as HTMLImageElement;
const selection = { x: 10, y: 20, w: 300, h: 200 };

function setup(over: Partial<Parameters<typeof useCaptureOutput>[0]> = {}) {
	return renderHook(() =>
		useCaptureOutput({
			image,
			selection,
			annotations: [],
			scale: { x: 0.5, y: 0.5 },
			...over,
		}),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(composeCapture).mockResolvedValue(PNG);
	vi.mocked(copyCapture).mockResolvedValue(undefined);
	vi.mocked(saveCapture).mockResolvedValue("/x/knivchit.png");
	vi.mocked(saveCaptureAs).mockResolvedValue("/x/elegida.png");
	vi.mocked(pinCapture).mockResolvedValue("pin-1");
	close.mockResolvedValue(undefined);
});

describe("useCaptureOutput (C4)", () => {
	it("copy: compone el recorte, lo copia y cierra; no guarda ni fija", async () => {
		const { result } = setup();
		await act(() => result.current.run("copy"));
		expect(composeCapture).toHaveBeenCalledWith(image, selection, []);
		expect(copyCapture).toHaveBeenCalledWith(PNG);
		expect(saveCapture).not.toHaveBeenCalled();
		expect(pinCapture).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
	});

	it("save: guarda en la carpeta de Settings y cierra; no toca el portapapeles", async () => {
		const { result } = setup();
		await act(() => result.current.run("save"));
		expect(saveCapture).toHaveBeenCalledWith(PNG);
		expect(copyCapture).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
	});

	it("save-as: abre el diálogo nativo y cierra si el usuario elige una ruta", async () => {
		const { result } = setup();
		await act(() => result.current.run("save-as"));
		expect(saveCaptureAs).toHaveBeenCalledWith(PNG);
		expect(saveCapture).not.toHaveBeenCalled();
		expect(copyCapture).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
	});

	it("save-as: si el usuario cancela el diálogo, el overlay sigue abierto y se puede reintentar", async () => {
		vi.mocked(saveCaptureAs).mockResolvedValueOnce(null);
		const { result } = setup();
		await act(() => result.current.run("save-as"));
		expect(close).not.toHaveBeenCalled();
		expect(result.current.busy).toBe(false);
		expect(result.current.error).toBeNull();

		await act(() => result.current.run("save-as"));
		expect(saveCaptureAs).toHaveBeenCalledTimes(2);
		expect(close).toHaveBeenCalledOnce();
	});

	it("pin: el tamaño lógico es el de la selección por la escala de pantalla", async () => {
		const { result } = setup();
		await act(() => result.current.run("pin"));
		expect(pinCapture).toHaveBeenCalledWith(PNG, 150, 100);
		expect(close).toHaveBeenCalledOnce();
	});

	it("pasa las anotaciones al compositor", async () => {
		const annotations = [
			{
				id: "a",
				kind: "rect" as const,
				color: "red",
				stroke_width: 2,
				start: { x: 0, y: 0 },
				end: { x: 5, y: 5 },
			},
		];
		const { result } = setup({ annotations });
		await act(() => result.current.run("copy"));
		expect(composeCapture).toHaveBeenCalledWith(image, selection, annotations);
	});

	it.each([
		["sin imagen", { image: null }],
		["sin selección", { selection: null }],
		["selección de ancho < 1", { selection: { x: 0, y: 0, w: 0, h: 50 } }],
		["selección de alto < 1", { selection: { x: 0, y: 0, w: 50, h: 0 } }],
	])("%s: no hace nada", async (_n, over) => {
		const { result } = setup(over);
		for (const kind of ["copy", "save", "save-as", "pin"] as const) {
			await act(() => result.current.run(kind));
		}
		expect(composeCapture).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
	});

	it("si el backend falla: deja el overlay abierto, expone el error y se puede reintentar", async () => {
		vi.mocked(copyCapture).mockRejectedValueOnce(new Error("no es un PNG"));
		const { result } = setup();
		await act(() => result.current.run("copy"));
		expect(result.current.error).toBe("no es un PNG");
		expect(result.current.busy).toBe(false);
		expect(close).not.toHaveBeenCalled();

		await act(() => result.current.run("copy"));
		expect(result.current.error).toBeNull();
		expect(close).toHaveBeenCalledOnce();
	});

	it("un error en forma de texto (como lo manda Tauri) también se muestra", async () => {
		vi.mocked(saveCapture).mockRejectedValueOnce("carpeta no válida");
		const { result } = setup();
		await act(() => result.current.run("save"));
		expect(result.current.error).toBe("carpeta no válida");
		expect(close).not.toHaveBeenCalled();
	});

	it("si falla la composición no envía nada al backend", async () => {
		vi.mocked(composeCapture).mockRejectedValueOnce(new Error("canvas"));
		const { result } = setup();
		await act(() => result.current.run("copy"));
		expect(copyCapture).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(result.current.error).toBe("canvas");
	});

	it("doble disparo seguido (p. ej. Enter dos veces) envía la salida una sola vez", async () => {
		const { result } = setup();
		await act(async () => {
			await Promise.all([
				result.current.run("copy"),
				result.current.run("copy"),
			]);
		});
		expect(copyCapture).toHaveBeenCalledTimes(1);
	});
});
