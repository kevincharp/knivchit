import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => ({
	getPinImage: vi.fn(),
	closePin: vi.fn(),
}));

import { closePin, getPinImage } from "../../lib/tauri";
import { PinWindow } from "./PinWindow";

const getPinImageMock = vi.mocked(getPinImage);
const closePinMock = vi.mocked(closePin);

function open(search: string) {
	window.history.replaceState({}, "", `/index.html${search}`);
}

beforeEach(() => {
	getPinImageMock.mockReset();
	closePinMock.mockReset();
	getPinImageMock.mockResolvedValue("data:image/png;base64,AAAA");
	closePinMock.mockResolvedValue(undefined);
	open("?window=pin&label=pin-abc");
});
afterEach(() => {
	cleanup();
	window.history.replaceState({}, "", "/");
});

describe("PinWindow", () => {
	it("pide la imagen del label de la URL y la muestra", async () => {
		render(<PinWindow />);
		const img = await screen.findByRole("img", {
			name: "Captura fijada en pantalla",
		});
		expect(getPinImageMock).toHaveBeenCalledWith("pin-abc");
		expect(img).toHaveAttribute("src", "data:image/png;base64,AAAA");
	});

	it("no pinta nada hasta que llega la imagen", () => {
		getPinImageMock.mockReturnValue(new Promise(() => {}));
		const { container } = render(<PinWindow />);
		expect(container).toBeEmptyDOMElement();
	});

	it("sin label en la URL no pide ninguna imagen", () => {
		open("?window=pin");
		const { container } = render(<PinWindow />);
		expect(getPinImageMock).not.toHaveBeenCalled();
		expect(container).toBeEmptyDOMElement();
	});

	it("el botón de cierre tiene aria-label y cierra su propio label", async () => {
		render(<PinWindow />);
		const b = await screen.findByRole("button", {
			name: "Cerrar captura fijada",
		});
		fireEvent.click(b);
		expect(closePinMock).toHaveBeenCalledWith("pin-abc");
	});

	it("Esc cierra la ventana pin", async () => {
		render(<PinWindow />);
		await screen.findByRole("img");
		fireEvent.keyDown(window, { key: "Escape" });
		expect(closePinMock).toHaveBeenCalledWith("pin-abc");
	});

	it("otras teclas no cierran", async () => {
		render(<PinWindow />);
		await screen.findByRole("img");
		fireEvent.keyDown(window, { key: "Enter" });
		expect(closePinMock).not.toHaveBeenCalled();
	});

	it("la imagen es arrastrable como ventana y no como imagen del navegador", async () => {
		render(<PinWindow />);
		const img = await screen.findByRole("img");
		expect(img).toHaveAttribute("data-tauri-drag-region");
		expect(img).toHaveAttribute("draggable", "false");
	});

	it("la imagen llena la ventana sin recortarse (fill, nunca cover)", async () => {
		render(<PinWindow />);
		const img = await screen.findByRole("img");
		await waitFor(() => expect(img.style.objectFit).toBe("fill"));
	});
});
