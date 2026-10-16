import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	startCapture: vi.fn(),
	closeCurrentWindow: vi.fn(),
	minimizeCurrentWindow: vi.fn(),
	getCapturePermission: vi.fn(),
	requestCapturePermission: vi.fn(),
	onCapturePermissionChanged: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/tauri")>()),
	...m,
}));

import { AppShell } from "./AppShell";
import { FEATURES, type Feature, type PageProps } from "./features";

function Pagina({ name }: { name: string }) {
	return <h1>Página {name}</h1>;
}

function Home({ onCapture, captureError, onNavigate, capturing }: PageProps) {
	return (
		<div>
			<h1>Página Inicio</h1>
			<button type="button" onClick={onCapture} disabled={capturing}>
				Capturar
			</button>
			<button type="button" onClick={() => onNavigate("clipboard")}>
				Ir a portapapeles
			</button>
			{captureError && <p role="alert">{captureError}</p>}
		</div>
	);
}

const registry: Feature[] = FEATURES.map((f) =>
	f.status === "disponible"
		? { ...f, page: f.id === "home" ? Home : () => <Pagina name={f.name} /> }
		: f,
);

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.startCapture.mockResolvedValue(undefined);
	m.getCapturePermission.mockResolvedValue({ granted: true, last_error: null });
	m.onCapturePermissionChanged.mockResolvedValue(() => {});
});
afterEach(cleanup);

describe("AppShell", () => {
	it("tiene barra de título, barra lateral y contenido, y abre en Inicio", () => {
		render(<AppShell features={registry} />);
		expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
		expect(
			screen.getByRole("navigation", { name: "Secciones" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "Página Inicio" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Inicio" })).toHaveAttribute(
			"aria-current",
			"page",
		);
	});

	it("navega entre secciones y mueve aria-current", () => {
		render(<AppShell features={registry} />);
		fireEvent.click(screen.getByRole("button", { name: "Captura" }));
		expect(
			screen.getByRole("heading", { name: "Página Captura" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Captura" })).toHaveAttribute(
			"aria-current",
			"page",
		);
		expect(screen.getByRole("button", { name: "Inicio" })).not.toHaveAttribute(
			"aria-current",
		);
	});

	it("las secciones «Pronto» abren su página honesta, sin botones propios", () => {
		render(<AppShell features={registry} />);
		fireEvent.click(screen.getByRole("button", { name: /Texto/ }));
		const main = screen.getByRole("main");
		expect(main).toHaveTextContent("Texto en pantalla");
		expect(main).toHaveTextContent("Extraerá el texto");
		expect(main.querySelectorAll("button")).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: /Emojis/ }));
		expect(main).toHaveTextContent("Un selector rápido de emojis");
	});

	it("cada sección «Pronto» tiene su propia frase", () => {
		render(<AppShell features={registry} />);
		const frases = new Set<string>();
		for (const id of ["Texto", "Portapapeles", "Emojis"]) {
			fireEvent.click(screen.getByRole("button", { name: new RegExp(id) }));
			frases.add(screen.getByRole("main").textContent ?? "");
		}
		expect(frases.size).toBe(3);
	});

	it("una página puede navegar a otra por onNavigate", () => {
		render(<AppShell features={registry} />);
		fireEvent.click(screen.getByRole("button", { name: "Ir a portapapeles" }));
		expect(
			screen.getByRole("heading", { name: "Portapapeles" }),
		).toBeInTheDocument();
	});

	it("tras navegar, el foco pasa al contenido; al montar no se roba", () => {
		render(<AppShell features={registry} />);
		expect(screen.getByRole("main")).not.toHaveFocus();
		fireEvent.click(screen.getByRole("button", { name: "Captura" }));
		expect(screen.getByRole("main")).toHaveFocus();
	});

	it("«Capturar» inicia la captura y un fallo se cuenta SIN el texto técnico", async () => {
		m.startCapture.mockRejectedValueOnce("Portal request didn't succeed");
		render(<AppShell features={registry} />);
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(m.startCapture).toHaveBeenCalledOnce();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"No se pudo iniciar la captura. Inténtalo de nuevo.",
		);
		expect(screen.queryByText(/Portal request/)).toBeNull();
	});

	it("una captura iniciándose no admite otra: doble clic o tecla repetida llaman al comando UNA vez", async () => {
		let terminar: () => void = () => {};
		m.startCapture.mockImplementation(
			() => new Promise<void>((resolve) => (terminar = resolve)),
		);
		render(<AppShell features={registry} />);
		const boton = screen.getByRole("button", { name: "Capturar" });
		// Pulsaciones seguidas, antes de que React repinte el botón desactivado
		fireEvent.click(boton);
		fireEvent.click(boton);
		fireEvent.click(boton);
		expect(m.startCapture).toHaveBeenCalledTimes(1);
		expect(boton).toBeDisabled();
		terminar();
		await vi.waitFor(() => expect(boton).toBeEnabled());
	});

	it("tras terminar la captura el botón vuelve a admitir otra; tras un fallo también", async () => {
		render(<AppShell features={registry} />);
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		await vi.waitFor(() =>
			expect(screen.getByRole("button", { name: "Capturar" })).toBeEnabled(),
		);
		m.startCapture.mockRejectedValueOnce("sin portal");
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		await screen.findByRole("alert");
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(m.startCapture).toHaveBeenCalledTimes(3);
	});

	it("registro extensible: una función nueva aparece y se abre sin tocar nada más", () => {
		const nueva: Feature = {
			id: "ruler",
			name: "Regla",
			icon: <path d="M4 4h16" />,
			status: "pronto",
			description: "Medirá distancias en pantalla.",
			group: "main",
		};
		render(<AppShell features={[...registry, nueva]} />);
		fireEvent.click(screen.getByRole("button", { name: /Regla/ }));
		expect(screen.getByRole("main")).toHaveTextContent(
			"Medirá distancias en pantalla.",
		);
	});

	it("el panel es un contenedor redondeado y la barra de título no tiene borde inferior", () => {
		const { container } = render(<AppShell features={registry} />);
		expect(container.querySelector("header")?.className).not.toMatch(/border/);
		expect(container.innerHTML).toContain("rounded-[var(--radius-ui)]");
	});
});
