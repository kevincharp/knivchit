import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickerTab } from "../../lib/tauri";

const tauri = vi.hoisted(() => ({
	pickEmoji: vi.fn(),
	closePicker: vi.fn(),
	pickerActivity: vi.fn(),
	onPickerShow: vi.fn(),
}));
vi.mock("../../lib/tauri", () => tauri);

import { Picker } from "./Picker";

let show: (tab: PickerTab) => void;

beforeEach(() => {
	Element.prototype.scrollIntoView = vi.fn();
	tauri.pickEmoji.mockResolvedValue("copied");
	tauri.closePicker.mockResolvedValue(undefined);
	tauri.pickerActivity.mockResolvedValue(undefined);
	tauri.onPickerShow.mockImplementation(async (cb) => {
		show = cb;
		return () => {};
	});
});

afterEach(() => {
	cleanup();
	window.history.replaceState(null, "", "/");
	vi.clearAllMocks();
	vi.useRealTimers();
});

const search = () => screen.getByRole("searchbox");
const selected = () =>
	screen.getByRole("option", { selected: true }).textContent;
const options = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("Picker", () => {
	it("el foco está en el buscador al montar", () => {
		render(<Picker />);
		expect(search()).toHaveFocus();
	});

	it("escribir filtra por la búsqueda", () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "bandera argentina" } });
		expect(options()[0]).toBe("🇦🇷");
		expect(options()).not.toContain("😀");
	});

	it("las flechas mueven la selección y Enter elige ese emoji", () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "corazon" } });
		const all = options();
		expect(selected()).toBe(all[0]);
		fireEvent.keyDown(search(), { key: "ArrowRight" });
		expect(selected()).toBe(all[1]);
		fireEvent.keyDown(search(), { key: "ArrowDown" });
		expect(selected()).toBe(all[Math.min(1 + 8, all.length - 1)]);
		fireEvent.keyDown(search(), { key: "ArrowLeft" });
		const elegido = selected();
		fireEvent.keyDown(search(), { key: "Enter" });
		expect(tauri.pickEmoji).toHaveBeenCalledWith(elegido);
	});

	it("Enter elige exactamente el carácter seleccionado", () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "bandera argentina" } });
		fireEvent.keyDown(search(), { key: "Enter" });
		expect(tauri.pickEmoji).toHaveBeenCalledWith("🇦🇷");
	});

	it("elegir una secuencia compuesta la pasa intacta", () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "familia hombre mujer" } });
		fireEvent.click(
			screen.getAllByRole("option").find((o) => o.textContent === "👨‍👩‍👧‍👦") ??
				screen.getAllByRole("option")[0],
		);
		expect(tauri.pickEmoji).toHaveBeenCalledWith("👨‍👩‍👧‍👦");
	});

	it("Esc borra el texto y el siguiente cierra el panel", () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "gato" } });
		fireEvent.keyDown(search(), { key: "Escape" });
		expect(search()).toHaveValue("");
		expect(tauri.closePicker).not.toHaveBeenCalled();
		fireEvent.keyDown(search(), { key: "Escape" });
		expect(tauri.closePicker).toHaveBeenCalledTimes(1);
	});

	it("el orden de Tab es buscador, categorías y lista", () => {
		render(<Picker />);
		const stops = Array.from(
			document.querySelectorAll<HTMLElement>(
				"input, button, [tabindex]:not([tabindex='-1'])",
			),
		).filter((el) => el.tabIndex >= 0);
		const roles = stops.map(
			(el) =>
				el.getAttribute("role") ?? el.closest("[role]")?.getAttribute("role"),
		);
		const iSearch = stops.indexOf(search());
		const iCategory = roles.indexOf("toolbar");
		const iList = roles.indexOf("listbox");
		expect(iSearch).toBeLessThan(iCategory);
		expect(iCategory).toBeLessThan(iList);
	});

	it("Ctrl+Tab cambia de pestaña", () => {
		const { container } = render(<Picker />);
		fireEvent.keyDown(search(), { key: "Tab", ctrlKey: true });
		expect(screen.getByText("Pronto")).toBeInTheDocument();
		expect(screen.queryByRole("searchbox")).toBeNull();
		fireEvent.keyDown(container.firstElementChild as Element, {
			key: "Tab",
			ctrlKey: true,
		});
		expect(screen.getByRole("searchbox")).toBeInTheDocument();
	});

	it("onPickerShow con «clipboard» muestra la pestaña Portapapeles con solo «Pronto»", async () => {
		render(<Picker />);
		await waitFor(() => expect(tauri.onPickerShow).toHaveBeenCalled());
		act(() => show("clipboard"));
		expect(screen.getByText("Pronto")).toBeInTheDocument();
		expect(screen.queryByRole("option")).toBeNull();
		act(() => show("emoji"));
		expect(search()).toHaveFocus();
	});

	it("las categorías se muestran en español y ninguna en inglés", () => {
		render(<Picker />);
		const nombres = screen
			.getByRole("toolbar", { name: "Categorías" })
			.querySelectorAll("button");
		expect(Array.from(nombres, (b) => b.getAttribute("aria-label"))).toEqual([
			"Caras y emociones",
			"Personas",
			"Animales y naturaleza",
			"Comida y bebida",
			"Viajes y lugares",
			"Actividades",
			"Objetos",
			"Símbolos",
			"Banderas",
		]);
		expect(document.body.innerHTML).not.toMatch(/Smileys|People & Body|Flags/);
	});

	it("elegir una categoría filtra por su grupo", () => {
		render(<Picker />);
		fireEvent.click(screen.getByRole("button", { name: "Banderas" }));
		expect(options()).toContain("🇦🇷");
		expect(options()).not.toContain("😀");
	});

	it("no hay botón de cerrar", () => {
		render(<Picker />);
		expect(screen.queryByRole("button", { name: /cerrar/i })).toBeNull();
	});

	it("muestra el pie con la ayuda y «Copiado» ~1,5 s tras copiar", async () => {
		vi.useFakeTimers();
		render(<Picker />);
		expect(screen.getByText("Clic: copiar · Esc: cerrar")).toBeInTheDocument();
		fireEvent.keyDown(search(), { key: "Enter" });
		await act(async () => {});
		expect(screen.getByText("Copiado")).toBeInTheDocument();
		act(() => {
			vi.advanceTimersByTime(1600);
		});
		expect(screen.queryByText("Copiado")).toBeNull();
	});

	it("pickerActivity se llama como mucho una vez por segundo", () => {
		vi.useFakeTimers();
		render(<Picker />);
		fireEvent.keyDown(search(), { key: "a" });
		fireEvent.keyDown(search(), { key: "b" });
		fireEvent.click(search());
		expect(tauri.pickerActivity).toHaveBeenCalledTimes(1);
		act(() => {
			vi.advanceTimersByTime(1001);
		});
		fireEvent.keyDown(search(), { key: "c" });
		expect(tauri.pickerActivity).toHaveBeenCalledTimes(2);
	});

	it("los recientes aparecen al frente", async () => {
		render(<Picker />);
		fireEvent.change(search(), { target: { value: "mate" } });
		fireEvent.keyDown(search(), { key: "Enter" });
		await screen.findByText("Copiado", {}, { timeout: 4000 });
		fireEvent.change(search(), { target: { value: "" } });
		expect(options()[0]).toBe("🧉");
	});

	it("la pestaña inicial sale de la URL y un valor desconocido cae a emojis", () => {
		window.history.replaceState(null, "", "/?window=picker&tab=clipboard");
		const { unmount } = render(<Picker />);
		expect(screen.queryByRole("searchbox")).toBeNull();
		unmount();
		window.history.replaceState(null, "", "/?window=picker&tab=otra");
		render(<Picker />);
		expect(search()).toBeInTheDocument();
	});
});
