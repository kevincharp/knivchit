import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getSettings: vi.fn(),
	updateSettings: vi.fn(),
	getIntegrationStatus: vi.fn(),
	chooseSaveDir: vi.fn(),
	getShortcuts: vi.fn(),
	openSaveDir: vi.fn(),
}));
vi.mock("../../lib/tauri", () => m);

import { FEATURES } from "./features";
import { PageHome } from "./PageHome";

const base = {
	clipboard_cap_count: 100,
	clipboard_cap_days: 30,
	sensitive_exclude_enabled: true,
};

function mount(over: Partial<React.ComponentProps<typeof PageHome>> = {}) {
	const props = {
		features: FEATURES,
		onNavigate: vi.fn(),
		onCapture: vi.fn(),
		captureError: null,
		...over,
	};
	return { props, ...render(<PageHome {...props} />) };
}

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.getSettings.mockResolvedValue({
		...base,
		screenshot_save_dir: "/home/u/Capturas",
	});
	m.getIntegrationStatus.mockResolvedValue({ extension_active: true });
	m.getShortcuts.mockResolvedValue({
		extension_active: true,
		shortcuts: { capture: "<Super><Shift>c" },
	});
	m.updateSettings.mockResolvedValue(undefined);
	m.openSaveDir.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("PageHome", () => {
	it("«Capturar» inicia la captura y el atajo asignado se muestra como chips", async () => {
		const { props } = mount();
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(props.onCapture).toHaveBeenCalledOnce();
		expect(
			await screen.findByRole("img", { name: "Super + Shift + C" }),
		).toBeInTheDocument();
	});

	it("sin atajo asignado: «Atajo: sin asignar», botón que lleva a Configuración y Capturar sigue funcionando", async () => {
		m.getShortcuts.mockResolvedValue({ extension_active: true, shortcuts: {} });
		const { props } = mount();
		expect(await screen.findByText("Atajo: sin asignar")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Asignar atajo" }));
		expect(props.onNavigate).toHaveBeenCalledWith("settings");
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(props.onCapture).toHaveBeenCalledOnce();
	});

	it("si no se pueden leer los atajos, se trata como sin asignar", async () => {
		m.getShortcuts.mockRejectedValue(new Error("sin backend"));
		mount();
		expect(await screen.findByText("Atajo: sin asignar")).toBeInTheDocument();
	});

	it("muestra el error de captura", () => {
		mount({ captureError: "sin portal" });
		expect(screen.getByRole("alert")).toHaveTextContent("sin portal");
	});

	it("atajo global activo", async () => {
		mount();
		expect(await screen.findByText("Activo")).toBeInTheDocument();
	});

	it("atajo global inactivo explica cómo activarlo", async () => {
		m.getIntegrationStatus.mockResolvedValue({ extension_active: false });
		mount();
		expect(await screen.findByText("Inactivo")).toBeInTheDocument();
		expect(
			screen.getByText(/Cierra sesión y vuelve a entrar/),
		).toBeInTheDocument();
	});

	it("si no se puede consultar la integración, lo dice sin romper", async () => {
		m.getIntegrationStatus.mockRejectedValue(new Error("sin comando"));
		mount();
		expect(await screen.findByText("No se pudo comprobar")).toBeInTheDocument();
	});

	it("muestra la carpeta de guardado y «Abrir carpeta» la abre", async () => {
		mount();
		expect(await screen.findByText("/home/u/Capturas")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Abrir carpeta" }));
		await waitFor(() => expect(m.openSaveDir).toHaveBeenCalledOnce());
	});

	it("si no se puede abrir la carpeta, avisa", async () => {
		m.openSaveDir.mockRejectedValue("permiso denegado");
		mount();
		await screen.findByText("/home/u/Capturas");
		fireEvent.click(screen.getByRole("button", { name: "Abrir carpeta" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"permiso denegado",
		);
	});

	it("las funciones futuras salen del registro, con insignia, y abren su página", () => {
		const { props } = mount();
		const grid = screen.getByRole("region", { name: "Próximamente" });
		const cards = grid.querySelectorAll("button");
		expect(cards).toHaveLength(3);
		expect(grid.textContent?.match(/Pronto/g)).toHaveLength(3);
		fireEvent.click(screen.getByRole("button", { name: /Portapapeles/ }));
		expect(props.onNavigate).toHaveBeenCalledWith("clipboard");
	});

	it("muestra un consejo", () => {
		mount();
		expect(screen.getByText("Consejo:", { exact: false })).toBeInTheDocument();
	});

	it("no hay lista de primeros pasos si la carpeta ya está elegida", async () => {
		mount();
		await screen.findByText("/home/u/Capturas");
		expect(screen.queryByText("Para empezar")).not.toBeInTheDocument();
	});
});

describe("PageHome — primer uso (sustituye al Onboarding)", () => {
	beforeEach(() => {
		m.getSettings.mockResolvedValue({
			...base,
			screenshot_save_dir: "__PLACEHOLDER__",
		});
	});

	it("el paso «Elige tu atajo» ofrece Asignar atajo cuando no hay ninguno", async () => {
		m.getShortcuts.mockResolvedValue({ extension_active: true, shortcuts: {} });
		const { props } = mount();
		await screen.findByText("Para empezar");
		const buttons = await screen.findAllByRole("button", {
			name: "Asignar atajo",
		});
		expect(buttons.length).toBeGreaterThanOrEqual(2);
		fireEvent.click(buttons[buttons.length - 1]);
		expect(props.onNavigate).toHaveBeenCalledWith("settings");
	});

	it("muestra los tres pasos y la carpeta predeterminada", async () => {
		mount();
		expect(await screen.findByText("Para empezar")).toBeInTheDocument();
		expect(
			screen.getByText("Activa la extensión de GNOME Shell"),
		).toBeInTheDocument();
		expect(screen.getByText("Elige tu atajo")).toBeInTheDocument();
		expect(screen.getByText("~/Pictures/Screenshots")).toBeInTheDocument();
	});

	it("«Usar la predeterminada» guarda ~/Pictures/Screenshots y cierra la lista", async () => {
		mount();
		fireEvent.click(
			await screen.findByRole("button", { name: "Usar la predeterminada" }),
		);
		await waitFor(() =>
			expect(m.updateSettings).toHaveBeenCalledWith({
				...base,
				screenshot_save_dir: "~/Pictures/Screenshots",
			}),
		);
		await waitFor(() =>
			expect(screen.queryByText("Para empezar")).not.toBeInTheDocument(),
		);
	});

	it("«Elegir carpeta…» guarda la elegida; si se cancela no cambia nada", async () => {
		m.chooseSaveDir.mockResolvedValueOnce(null);
		mount();
		const choose = await screen.findByRole("button", {
			name: "Elegir carpeta…",
		});
		fireEvent.click(choose);
		await waitFor(() => expect(m.chooseSaveDir).toHaveBeenCalledOnce());
		expect(m.updateSettings).not.toHaveBeenCalled();

		m.chooseSaveDir.mockResolvedValueOnce("/data/shots");
		fireEvent.click(choose);
		await waitFor(() =>
			expect(m.updateSettings).toHaveBeenCalledWith({
				...base,
				screenshot_save_dir: "/data/shots",
			}),
		);
	});
});
