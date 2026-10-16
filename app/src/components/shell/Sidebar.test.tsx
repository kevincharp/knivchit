import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEATURES, type Feature } from "./features";
import { PageComingSoon } from "./PageComingSoon";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

describe("registro FEATURES", () => {
	it("tiene las siete secciones, ids únicos, y solo las disponibles llevan página en su momento", () => {
		expect(FEATURES.map((f) => f.id)).toEqual([
			"home",
			"capture",
			"text",
			"clipboard",
			"emoji",
			"settings",
			"about",
		]);
		expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
		expect(
			FEATURES.filter((f) => f.status === "pronto").map((f) => f.id),
		).toEqual(["text", "clipboard", "emoji"]);
	});
});

describe("Sidebar", () => {
	it("es una navegación «Secciones» con un botón por función", () => {
		render(<Sidebar features={FEATURES} current="home" onSelect={() => {}} />);
		const nav = screen.getByRole("navigation", { name: "Secciones" });
		expect(nav.querySelectorAll("button")).toHaveLength(FEATURES.length);
	});

	it("marca la sección actual con aria-current=page y solo esa", () => {
		render(
			<Sidebar features={FEATURES} current="capture" onSelect={() => {}} />,
		);
		const current = screen
			.getAllByRole("button")
			.filter((b) => b.getAttribute("aria-current") === "page");
		expect(current).toHaveLength(1);
		expect(current[0]).toHaveAccessibleName("Captura");
	});

	it("las funciones «pronto» muestran la insignia Pronto; las disponibles no", () => {
		render(<Sidebar features={FEATURES} current="home" onSelect={() => {}} />);
		expect(screen.getAllByText("Pronto")).toHaveLength(3);
		expect(
			screen.getByRole("button", { name: /Portapapeles/ }),
		).toHaveTextContent("Pronto");
		expect(
			screen.getByRole("button", { name: "Inicio" }),
		).not.toHaveTextContent("Pronto");
	});

	it("clic llama a onSelect con el id", () => {
		const onSelect = vi.fn();
		render(<Sidebar features={FEATURES} current="home" onSelect={onSelect} />);
		fireEvent.click(screen.getByRole("button", { name: /Portapapeles/ }));
		expect(onSelect).toHaveBeenCalledWith("clipboard");
	});

	it("↓ y ↑ mueven el foco con vuelta en los extremos", () => {
		render(<Sidebar features={FEATURES} current="home" onSelect={() => {}} />);
		const buttons = screen.getAllByRole("button");
		buttons[0].focus();
		fireEvent.keyDown(buttons[0], { key: "ArrowUp" });
		expect(buttons[buttons.length - 1]).toHaveFocus();
		fireEvent.keyDown(document.activeElement as Element, { key: "ArrowDown" });
		expect(buttons[0]).toHaveFocus();
	});

	it("registro extensible: una entrada nueva aparece sin tocar otros componentes", () => {
		const nueva: Feature = {
			id: "ruler",
			name: "Regla",
			icon: <path d="M4 4h16" />,
			status: "pronto",
			description: "Medirá distancias en pantalla.",
			group: "main",
		};
		render(
			<Sidebar
				features={[...FEATURES, nueva]}
				current="home"
				onSelect={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: /Regla/ })).toBeInTheDocument();
	});

	it("no usa box-shadow", () => {
		const { container } = render(
			<Sidebar features={FEATURES} current="home" onSelect={() => {}} />,
		);
		for (const el of container.querySelectorAll<HTMLElement>("*")) {
			expect(el.style.boxShadow).toBe("");
		}
	});
});

describe("PageComingSoon", () => {
	const clipboard = FEATURES.find((f) => f.id === "clipboard") as Feature;

	it("muestra nombre, insignia y frase honesta, sin botones", () => {
		render(<PageComingSoon feature={clipboard} />);
		expect(
			screen.getByRole("heading", { name: "Portapapeles" }),
		).toBeInTheDocument();
		expect(screen.getByText("Pronto")).toBeInTheDocument();
		expect(screen.getByText(clipboard.description)).toBeInTheDocument();
		expect(
			screen.getByText(/no está disponible en esta versión/),
		).toBeInTheDocument();
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});
});
