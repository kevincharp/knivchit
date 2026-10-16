import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ close: vi.fn(), minimize: vi.fn() }));
vi.mock("../lib/tauri", () => ({
	closeCurrentWindow: m.close,
	minimizeCurrentWindow: m.minimize,
}));

import { TitleBar } from "./TitleBar";

afterEach(() => {
	cleanup();
	m.close.mockReset();
	m.minimize.mockReset();
});

describe("TitleBar", () => {
	it("muestra el título y los botones accesibles Minimizar y Cerrar", () => {
		render(<TitleBar />);
		expect(screen.getByText("Knivchit")).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Minimizar" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
	});

	it("Cerrar y Minimizar llaman a la ventana", () => {
		render(<TitleBar />);
		fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
		expect(m.close).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: "Minimizar" }));
		expect(m.minimize).toHaveBeenCalledOnce();
	});

	it("la barra arrastra la ventana pero los botones no", () => {
		const { container } = render(<TitleBar />);
		expect(container.querySelector("header")).toHaveAttribute(
			"data-tauri-drag-region",
		);
		for (const b of screen.getAllByRole("button")) {
			expect(b).not.toHaveAttribute("data-tauri-drag-region");
			expect(b.closest("[data-tauri-drag-region]")).toBe(
				container.querySelector("header"),
			);
		}
	});

	it("los iconos son de 20 px con trazo 2 y no se anuncian", () => {
		const { container } = render(<TitleBar />);
		for (const svg of container.querySelectorAll("button svg")) {
			expect(svg).toHaveAttribute("width", "20");
			expect(svg).toHaveAttribute("stroke-width", "2");
			expect(svg).toHaveAttribute("aria-hidden", "true");
		}
	});
});
