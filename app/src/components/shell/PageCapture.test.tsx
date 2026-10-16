import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getShortcuts: vi.fn() }));
vi.mock("../../lib/tauri", () => m);

import { FEATURES } from "./features";
import { PageCapture } from "./PageCapture";

beforeEach(() => {
	m.getShortcuts.mockReset();
	m.getShortcuts.mockResolvedValue({
		extension_active: true,
		shortcuts: { capture: "<Super><Shift>c" },
	});
});
afterEach(cleanup);

function mount(over: Partial<React.ComponentProps<typeof PageCapture>> = {}) {
	const props = {
		features: FEATURES,
		onNavigate: vi.fn(),
		onCapture: vi.fn(),
		captureError: null,
		...over,
	};
	render(<PageCapture {...props} />);
	return props;
}

describe("PageCapture", () => {
	it("tiene título y el botón «Capturar» inicia la captura", () => {
		const p = mount();
		expect(
			screen.getByRole("heading", { name: "Captura", level: 1 }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(p.onCapture).toHaveBeenCalledOnce();
	});

	it("muestra el atajo asignado como chips", async () => {
		mount();
		expect(
			await screen.findByRole("img", { name: "Super + Shift + C" }),
		).toBeInTheDocument();
	});

	it("sin atajo: «sin asignar» y un botón que lleva a Configuración", async () => {
		m.getShortcuts.mockResolvedValue({ extension_active: true, shortcuts: {} });
		const p = mount();
		expect(await screen.findByText(/Atajo: sin asignar/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Asignar atajo" }));
		expect(p.onNavigate).toHaveBeenCalledWith("settings");
	});

	it("muestra el error de captura", () => {
		mount({ captureError: "sin portal" });
		expect(screen.getByRole("alert")).toHaveTextContent("sin portal");
	});

	it("guía las ocho herramientas con su atajo", () => {
		mount();
		const tools = screen.getByRole("region", { name: "Herramientas" });
		const esperado: [string, string][] = [
			["Seleccionar", "Alt+H · H · V"],
			["Rectángulo", "Alt+R · R"],
			["Elipse", "Alt+O · O"],
			["Flecha", "Alt+F · F"],
			["Lápiz", "Alt+L · L"],
			["Texto", "Alt+T · T"],
			["Mosaico", "Alt+M · M"],
			["Borrador", "Alt+B · B"],
		];
		expect(tools.querySelectorAll("li")).toHaveLength(8);
		for (const [name, keys] of esperado) {
			expect(tools).toHaveTextContent(name);
			expect(tools).toHaveTextContent(keys);
		}
	});

	it("lista los atajos como pares término/definición", () => {
		mount();
		const keys = screen.getByRole("region", { name: "Atajos" });
		expect(keys.querySelectorAll("dt")).toHaveLength(7);
		expect(keys).toHaveTextContent("Guardar como…");
		expect(keys.querySelectorAll("kbd").length).toBeGreaterThan(6);
	});
});
