import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getAppVersion: vi.fn(),
	checkForUpdate: vi.fn(),
}));
vi.mock("../../lib/tauri", () => m);

import { FEATURES } from "./features";
import { PageAbout } from "./PageAbout";

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.getAppVersion.mockResolvedValue("0.1.0");
});
afterEach(cleanup);

describe("PageAbout", () => {
	it("muestra nombre, versión y licencias", async () => {
		render(<PageAbout />);
		expect(await screen.findByText("Versión 0.1.0")).toBeInTheDocument();
		expect(screen.getByText("Knivchit")).toBeInTheDocument();
		const dl = screen.getByRole("region", { name: "Licencias" });
		expect(dl).toHaveTextContent("MIT");
		expect(dl).toHaveTextContent("GPL-3.0");
	});

	it("el repositorio público figura como «Pronto» sin enlace", () => {
		render(<PageAbout />);
		expect(screen.getByText("Repositorio público")).toBeInTheDocument();
		expect(screen.getByText("Pronto")).toBeInTheDocument();
		expect(screen.queryByRole("link")).not.toBeInTheDocument();
	});

	it("sin actualización: «Estás al día»", async () => {
		m.checkForUpdate.mockResolvedValue({
			has_update: false,
			latest_version: "0.1.0",
		});
		render(<PageAbout />);
		await screen.findByText("Versión 0.1.0");
		fireEvent.click(
			screen.getByRole("button", { name: "Buscar actualizaciones" }),
		);
		expect(await screen.findByText(/Estás al día/)).toBeInTheDocument();
	});

	it("con actualización: indica la versión nueva", async () => {
		m.checkForUpdate.mockResolvedValue({
			has_update: true,
			latest_version: "0.2.0",
		});
		render(<PageAbout />);
		fireEvent.click(
			screen.getByRole("button", { name: "Buscar actualizaciones" }),
		);
		expect(
			await screen.findByText("Hay una versión nueva: 0.2.0."),
		).toBeInTheDocument();
	});

	it("si falla, lo dice sin romper y deja reintentar", async () => {
		m.checkForUpdate.mockRejectedValue(new Error("sin red"));
		render(<PageAbout />);
		const btn = screen.getByRole("button", { name: "Buscar actualizaciones" });
		fireEvent.click(btn);
		expect(await screen.findByText(/No se pudo comprobar/)).toBeInTheDocument();
		await waitFor(() => expect(btn).toBeEnabled());
	});

	it("Acerca de está registrada con su página", () => {
		expect(FEATURES.find((f) => f.id === "about")?.page).toBe(PageAbout);
	});
});
