import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/tauri", () => ({
	startCapture: vi.fn(),
	closeCurrentWindow: vi.fn(),
	minimizeCurrentWindow: vi.fn(),
	getSettings: vi.fn().mockResolvedValue({
		screenshot_save_dir: "/home/u/Capturas",
		clipboard_cap_count: 100,
		clipboard_cap_days: 30,
		sensitive_exclude_enabled: true,
	}),
	getIntegrationStatus: vi.fn().mockResolvedValue({ extension_active: true }),
	openSaveDir: vi.fn(),
	chooseSaveDir: vi.fn(),
	updateSettings: vi.fn(),
	getCapturePermission: vi.fn().mockResolvedValue({
		granted: true,
		last_error: null,
	}),
	requestCapturePermission: vi.fn(),
	onCapturePermissionChanged: vi.fn().mockResolvedValue(() => {}),
	captureErrorCode: () => null,
}));

import App from "./App";

afterEach(cleanup);

describe("App (ventana principal)", () => {
	it("monta el hub: barra de título, barra lateral y la página Inicio", async () => {
		render(<App />);
		expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
		expect(
			screen.getByRole("navigation", { name: "Secciones" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Capturar" }),
		).toBeInTheDocument();
		expect(await screen.findByText("/home/u/Capturas")).toBeInTheDocument();
	});

	it("el portapapeles ya no se muestra como si funcionara", () => {
		render(<App />);
		expect(screen.queryByText("Capturar pantalla")).not.toBeInTheDocument();
		const nav = screen.getByRole("navigation", { name: "Secciones" });
		expect(
			within(nav).getByRole("button", { name: /Portapapeles/ }),
		).toHaveTextContent("Pronto");
	});
});
