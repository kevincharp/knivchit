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
	chooseSaveDir: vi.fn(),
	openSaveDir: vi.fn(),
	getAutostart: vi.fn(),
	setAutostart: vi.fn(),
	getShortcuts: vi.fn(),
	setShortcut: vi.fn(),
	checkShortcutConflicts: vi.fn(),
	getPanelIcon: vi.fn(),
	setPanelIcon: vi.fn(),
	quitApp: vi.fn(),
}));
vi.mock("../../lib/tauri", () => m);

import { APP_NAME } from "../../lib/appName";
import { setThemeChoice } from "../../lib/theme";
import { FEATURES } from "./features";
import { PageSettings } from "./PageSettings";

const base = {
	clipboard_cap_count: 100,
	clipboard_cap_days: 30,
	sensitive_exclude_enabled: true,
};

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.getSettings.mockResolvedValue({
		...base,
		screenshot_save_dir: "/home/u/Capturas",
	});
	m.updateSettings.mockResolvedValue(undefined);
	m.openSaveDir.mockResolvedValue(undefined);
	m.getAutostart.mockResolvedValue(false);
	m.setAutostart.mockResolvedValue(undefined);
	m.getShortcuts.mockResolvedValue({ extension_active: true, shortcuts: {} });
	m.getPanelIcon.mockResolvedValue({ extension_active: true, enabled: true });
	m.setPanelIcon.mockResolvedValue(undefined);
	m.quitApp.mockResolvedValue(undefined);
	localStorage.clear();
	setThemeChoice("system");
});
afterEach(cleanup);

describe("PageSettings — carpeta", () => {
	it("muestra la carpeta y «Abrir carpeta» llama a openSaveDir", async () => {
		render(<PageSettings />);
		expect(await screen.findByText("/home/u/Capturas")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Abrir carpeta" }));
		await waitFor(() => expect(m.openSaveDir).toHaveBeenCalledOnce());
	});

	it("«Cambiar…» guarda la carpeta elegida; si se cancela no cambia nada", async () => {
		render(<PageSettings />);
		await screen.findByText("/home/u/Capturas");
		m.chooseSaveDir.mockResolvedValueOnce(null);
		fireEvent.click(screen.getByRole("button", { name: "Cambiar…" }));
		await waitFor(() => expect(m.chooseSaveDir).toHaveBeenCalledOnce());
		expect(m.updateSettings).not.toHaveBeenCalled();

		m.chooseSaveDir.mockResolvedValueOnce("/data/shots");
		fireEvent.click(screen.getByRole("button", { name: "Cambiar…" }));
		await waitFor(() =>
			expect(m.updateSettings).toHaveBeenCalledWith({
				...base,
				screenshot_save_dir: "/data/shots",
			}),
		);
		expect(await screen.findByText("/data/shots")).toBeInTheDocument();
	});

	it("avisa si no se puede abrir la carpeta", async () => {
		m.openSaveDir.mockRejectedValue("sin gestor de archivos");
		render(<PageSettings />);
		await screen.findByText("/home/u/Capturas");
		fireEvent.click(screen.getByRole("button", { name: "Abrir carpeta" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"sin gestor de archivos",
		);
	});
});

describe("PageSettings — iniciar con la sesión", () => {
	it("refleja el estado real y lo cambia", async () => {
		render(<PageSettings />);
		const sw = await screen.findByRole("switch", {
			name: "Iniciar con la sesión",
		});
		await waitFor(() => expect(sw).toBeEnabled());
		expect(sw).toHaveAttribute("aria-checked", "false");
		fireEvent.click(sw);
		expect(sw).toHaveAttribute("aria-checked", "true");
		await waitFor(() => expect(m.setAutostart).toHaveBeenCalledWith(true));
	});

	it("si el backend no puede escribir, revierte y avisa", async () => {
		m.setAutostart.mockRejectedValue("no se pudo escribir");
		render(<PageSettings />);
		const sw = await screen.findByRole("switch", {
			name: "Iniciar con la sesión",
		});
		await waitFor(() => expect(sw).toBeEnabled());
		fireEvent.click(sw);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"no se pudo escribir",
		);
		expect(sw).toHaveAttribute("aria-checked", "false");
	});
});

describe("PageSettings — apariencia", () => {
	it("radiogrupo Sistema/Oscuro/Claro con «Sistema» por defecto", () => {
		render(<PageSettings />);
		const group = screen.getByRole("radiogroup", { name: "Apariencia" });
		expect(group.querySelectorAll("[role=radio]")).toHaveLength(3);
		expect(screen.getByRole("radio", { name: "Sistema" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
	});

	it("elegir una opción aplica data-theme y lo guarda", () => {
		render(<PageSettings />);
		fireEvent.click(screen.getByRole("radio", { name: "Claro" }));
		expect(document.documentElement.getAttribute("data-theme")).toBe("light");
		expect(localStorage.getItem("knivchit-theme")).toBe("light");
		expect(screen.getByRole("radio", { name: "Claro" })).toHaveAttribute(
			"aria-checked",
			"true",
		);
		fireEvent.click(screen.getByRole("radio", { name: "Oscuro" }));
		expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	});

	it("las flechas cambian de opción y mueven el foco; solo la elegida está en el orden de tabulación", () => {
		render(<PageSettings />);
		const sistema = screen.getByRole("radio", { name: "Sistema" });
		sistema.focus();
		fireEvent.keyDown(sistema, { key: "ArrowRight" });
		const oscuro = screen.getByRole("radio", { name: "Oscuro" });
		expect(oscuro).toHaveAttribute("aria-checked", "true");
		expect(oscuro).toHaveFocus();
		expect(oscuro).toHaveAttribute("tabindex", "0");
		expect(screen.getByRole("radio", { name: "Claro" })).toHaveAttribute(
			"tabindex",
			"-1",
		);
		fireEvent.keyDown(oscuro, { key: "ArrowLeft" });
		expect(sistema).toHaveAttribute("aria-checked", "true");
	});
});

describe("registro", () => {
	it("Configuración está registrada con su página", () => {
		expect(FEATURES.find((f) => f.id === "settings")?.page).toBe(PageSettings);
	});
});

describe("PageSettings — icono en la barra superior", () => {
	const interruptor = () =>
		screen.getByRole("switch", {
			name: "Mostrar icono en la barra superior",
		});

	it("muestra la ayuda con el nombre del producto y el interruptor activado por defecto", async () => {
		render(<PageSettings />);
		expect(
			screen.getByText(
				new RegExp(
					`Un clic en el icono abre esta ventana\\. Si lo desactivas, abre\\s+${APP_NAME}\\s+desde el menú de aplicaciones\\.`,
				),
			),
		).toBeInTheDocument();
		// mientras carga: activado por defecto, pero sin poder tocarse
		expect(interruptor()).toBeChecked();
		expect(interruptor()).toBeDisabled();
		await waitFor(() => expect(interruptor()).toBeEnabled());
		expect(interruptor()).toBeChecked();
	});

	it("refleja el estado real de la extensión (desactivado)", async () => {
		m.getPanelIcon.mockResolvedValue({
			extension_active: true,
			enabled: false,
		});
		render(<PageSettings />);
		await waitFor(() => expect(interruptor()).toBeEnabled());
		expect(interruptor()).not.toBeChecked();
	});

	it("alternar llama a setPanelIcon con el valor nuevo, con el ratón y con el teclado", async () => {
		render(<PageSettings />);
		await waitFor(() => expect(interruptor()).toBeEnabled());
		fireEvent.click(interruptor());
		await waitFor(() => expect(m.setPanelIcon).toHaveBeenLastCalledWith(false));
		expect(interruptor()).not.toBeChecked();
		// teclado: un botón con foco se activa con Enter/Espacio, que el navegador traduce en click
		interruptor().focus();
		expect(interruptor()).toHaveFocus();
		fireEvent.click(interruptor());
		await waitFor(() => expect(m.setPanelIcon).toHaveBeenLastCalledWith(true));
		expect(interruptor()).toBeChecked();
	});

	it("tiene role=switch, aria-checked y se puede enfocar con Tab", async () => {
		render(<PageSettings />);
		await waitFor(() => expect(interruptor()).toBeEnabled());
		expect(interruptor()).toHaveAttribute("aria-checked", "true");
		expect(interruptor()).not.toHaveAttribute("tabindex", "-1");
	});

	it("si guardar falla, revierte el valor y lo cuenta", async () => {
		m.setPanelIcon.mockRejectedValueOnce("no se pudo cambiar el icono");
		render(<PageSettings />);
		await waitFor(() => expect(interruptor()).toBeEnabled());
		fireEvent.click(interruptor());
		expect(
			await screen.findByText("no se pudo cambiar el icono"),
		).toBeInTheDocument();
		expect(interruptor()).toBeChecked();
		expect(interruptor()).toBeEnabled();
	});

	it.each([
		["extension_inactive", /La extensión de GNOME Shell no está activa/],
		["shortcuts_unavailable", /no acepta cambios desde esta ventana/],
		[
			"extension_outdated",
			/Reinicia la sesión para cargar la extensión actualizada/,
		],
	])(
		"al guardar, «%s» revierte, explica y deshabilita el interruptor",
		async (code, texto) => {
			m.setPanelIcon.mockRejectedValueOnce(code);
			render(<PageSettings />);
			await waitFor(() => expect(interruptor()).toBeEnabled());
			fireEvent.click(interruptor());
			expect(await screen.findByText(texto)).toBeInTheDocument();
			expect(interruptor()).toBeChecked();
			expect(interruptor()).toBeDisabled();
		},
	);

	it("sin extensión (extension_active:false) queda deshabilitado con el motivo", async () => {
		m.getPanelIcon.mockResolvedValue({
			extension_active: false,
			enabled: false,
		});
		render(<PageSettings />);
		expect(
			await screen.findByText(/La extensión de GNOME Shell no está activa/),
		).toBeInTheDocument();
		expect(interruptor()).toBeDisabled();
		expect(m.setPanelIcon).not.toHaveBeenCalled();
	});

	it.each([
		[
			"extension_outdated",
			/Reinicia la sesión para cargar la extensión actualizada/,
		],
		["shortcuts_unavailable", /no acepta cambios desde esta ventana/],
	])(
		"al leer, «%s» deshabilita el interruptor con su mensaje",
		async (code, texto) => {
			m.getPanelIcon.mockRejectedValue(code);
			render(<PageSettings />);
			expect(await screen.findByText(texto)).toBeInTheDocument();
			expect(interruptor()).toBeDisabled();
		},
	);
});

describe("PageSettings — salir", () => {
	it("«Salir de <app>» llama a quitApp una vez", async () => {
		render(<PageSettings />);
		const boton = screen.getByRole("button", { name: `Salir de ${APP_NAME}` });
		fireEvent.click(boton);
		fireEvent.click(boton);
		await waitFor(() => expect(m.quitApp).toHaveBeenCalledTimes(1));
	});

	it("si no se puede salir lo cuenta y deja volver a intentarlo", async () => {
		m.quitApp.mockRejectedValueOnce("no se pudo");
		render(<PageSettings />);
		fireEvent.click(
			screen.getByRole("button", { name: `Salir de ${APP_NAME}` }),
		);
		expect(await screen.findByRole("alert", { name: "" })).toBeDefined();
		expect(
			screen.getByText(/No se pudo salir: no se pudo/),
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole("button", { name: `Salir de ${APP_NAME}` }),
		);
		await waitFor(() => expect(m.quitApp).toHaveBeenCalledTimes(2));
	});

	it("está en Ajustes, en su propia tarjeta «Sesión», y no en la barra principal", () => {
		render(<PageSettings />);
		expect(screen.getByRole("heading", { name: "Sesión" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: `Salir de ${APP_NAME}` }),
		).toBeInTheDocument();
	});
});
