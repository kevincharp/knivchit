import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClipboardCardList } from "./ClipboardCardList";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

afterEach(() => {
	cleanup();
	invokeMock.mockReset();
});

describe("ClipboardCardList", () => {
	it("renderiza el estado vacío cuando get_clipboard_history devuelve []", async () => {
		invokeMock.mockResolvedValueOnce([]);
		render(<ClipboardCardList />);

		expect(
			await screen.findByText("Todavía no copiaste nada"),
		).toBeInTheDocument();
	});

	it("muestra el ícono de fijar en estado activo para una entrada pinned", async () => {
		invokeMock.mockResolvedValueOnce([
			{
				id: "1",
				content_type: "text",
				content: "hola",
				preview: null,
				source_app: null,
				created_at: "2026-01-01T00:00:00Z",
				pinned: true,
			},
		]);
		render(<ClipboardCardList />);

		const pinButton = await screen.findByRole("button", { name: "Fijar" });
		expect(pinButton).toHaveAttribute("aria-pressed", "true");
	});

	it('clickear "Borrar todo" llama clear_clipboard_history y vacía la lista', async () => {
		invokeMock
			.mockResolvedValueOnce([
				{
					id: "1",
					content_type: "text",
					content: "hola",
					preview: null,
					source_app: null,
					created_at: "2026-01-01T00:00:00Z",
					pinned: false,
				},
			])
			.mockResolvedValueOnce(undefined) // clear_clipboard_history
			.mockResolvedValueOnce([]); // refresh posterior

		render(<ClipboardCardList />);
		const clearButton = await screen.findByRole("button", {
			name: "Borrar todo",
		});
		fireEvent.click(clearButton);

		await waitFor(() => {
			expect(invokeMock).toHaveBeenCalledWith("clear_clipboard_history");
		});
		expect(
			await screen.findByText("Todavía no copiaste nada"),
		).toBeInTheDocument();
	});
});
