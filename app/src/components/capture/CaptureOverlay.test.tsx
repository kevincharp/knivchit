import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCapturePreview: vi.fn(),
	cancelCapture: vi.fn(),
	show: vi.fn(),
	setFocus: vi.fn(),
	webviewFocus: vi.fn(),
	close: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
	getCapturePreview: m.getCapturePreview,
	cancelCapture: m.cancelCapture,
	copyCapture: vi.fn(),
	saveCapture: vi.fn(),
	saveCaptureAs: vi.fn(),
	pinCapture: vi.fn(),
	captureActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		show: m.show,
		setFocus: m.setFocus,
		close: m.close,
	}),
}));

vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ setFocus: m.webviewFocus }),
}));

import { CaptureOverlay } from "./CaptureOverlay";

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.cancelCapture.mockResolvedValue(undefined);
	m.close.mockResolvedValue(undefined);
	m.webviewFocus.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("salvavidas del overlay (spec §12)", () => {
	it("si getCapturePreview rechaza, se muestra con el error y Esc cancela", async () => {
		m.getCapturePreview.mockRejectedValue(new Error("sin captura pendiente"));
		render(<CaptureOverlay />);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("sin captura pendiente");
		expect(m.show).toHaveBeenCalled();
		fireEvent.keyDown(document, { key: "Escape" });
		await waitFor(() => expect(m.cancelCapture).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(m.close).toHaveBeenCalled());
	});

	it("si la imagen falla al cargar (onError), se muestra y un clic cancela", async () => {
		m.getCapturePreview.mockResolvedValue("data:image/png;base64,roto");
		const { container } = render(<CaptureOverlay />);
		const img = await waitFor(() => {
			const el = container.querySelector("img");
			if (!el) throw new Error("aún sin img");
			return el;
		});
		fireEvent.error(img);
		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("No se pudo cargar la captura");
		expect(m.show).toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() => expect(m.cancelCapture).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(m.close).toHaveBeenCalled());
	});

	it("cierra aunque cancel_capture falle", async () => {
		m.getCapturePreview.mockRejectedValue(new Error("x"));
		m.cancelCapture.mockRejectedValue(new Error("fallo"));
		render(<CaptureOverlay />);
		await screen.findByRole("alert");
		fireEvent.click(screen.getByRole("button"));
		await waitFor(() => expect(m.close).toHaveBeenCalled());
	});
});

describe("salidas redundantes del overlay", () => {
	async function mount() {
		m.getCapturePreview.mockResolvedValue("data:image/png;base64,x");
		const view = render(<CaptureOverlay />);
		const img = await waitFor(() => {
			const el = view.container.querySelector("img");
			if (!el) throw new Error("aún sin img");
			return el;
		});
		return {
			...view,
			img,
			root: view.container.firstElementChild as HTMLElement,
		};
	}

	async function expectCancelled() {
		await waitFor(() => expect(m.cancelCapture).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(m.close).toHaveBeenCalledTimes(1));
	}

	it("muestra desde el inicio la pista y el botón Cancelar", async () => {
		await mount();
		expect(
			screen.getByText("Arrastra para seleccionar · Esc para cancelar"),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cancelar" })).toHaveAttribute(
			"title",
			"Cancelar",
		);
	});

	it("Esc cancela y cierra", async () => {
		await mount();
		fireEvent.keyDown(document, { key: "Escape" });
		await expectCancelled();
	});

	it("Esc cancela aunque el foco frene la propagación", async () => {
		const { root } = await mount();
		root.addEventListener("keydown", (e) => e.stopPropagation());
		fireEvent.keyDown(root, { key: "Escape" });
		await expectCancelled();
	});

	it("clic derecho cancela y cierra", async () => {
		const { root } = await mount();
		fireEvent.contextMenu(root);
		await expectCancelled();
	});

	it("el botón Cancelar cancela y cierra", async () => {
		await mount();
		fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		await expectCancelled();
	});

	it("al cargar la imagen muestra la ventana y fuerza el foco de teclado", async () => {
		const { img, root } = await mount();
		fireEvent.load(img);
		expect(m.show).toHaveBeenCalled();
		expect(m.setFocus).toHaveBeenCalled();
		expect(m.webviewFocus).toHaveBeenCalled();
		expect(root).toHaveAttribute("tabindex", "-1");
		expect(document.activeElement).toBe(root);
	});

	it("la raíz es una superficie sin selección ni arrastre nativo", async () => {
		const { root, img } = await mount();
		fireEvent.load(img);
		HTMLElement.prototype.setPointerCapture = vi.fn();
		expect(root).toHaveClass("capture-surface");
		for (const type of ["dragstart", "selectstart"]) {
			expect(
				fireEvent(img, new Event(type, { bubbles: true, cancelable: true })),
			).toBe(false);
		}
		expect(fireEvent.mouseDown(root)).toBe(false);
		expect(fireEvent.pointerDown(root, { button: 0, pointerId: 1 })).toBe(
			false,
		);
	});
});
