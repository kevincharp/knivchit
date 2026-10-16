import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getShortcuts: vi.fn(),
	setShortcut: vi.fn(),
	checkShortcutConflicts: vi.fn(),
	recordShortcut: vi.fn(),
}));
vi.mock("../../lib/tauri", () => m);

import { APP_NAME } from "../../lib/appName";
import { ShortcutsCard } from "./ShortcutsCard";

function state(active: boolean, capture?: string) {
	return {
		extension_active: active,
		shortcuts: capture ? { capture } : {},
	};
}

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.getShortcuts.mockResolvedValue(state(true));
	m.setShortcut.mockResolvedValue(undefined);
	m.checkShortcutConflicts.mockResolvedValue([]);
	m.recordShortcut.mockResolvedValue({
		accel: "<Control><Alt>k",
		status: "ok",
	});
});
afterEach(cleanup);

describe("ShortcutsCard — estados", () => {
	it("sin extensión lo explica y no ofrece grabar", async () => {
		m.getShortcuts.mockResolvedValue(state(false));
		render(<ShortcutsCard />);
		expect(await screen.findByText(/aún no está\s+activa/)).toBeInTheDocument();
		expect(
			screen.getByText(/Cierra sesión y vuelve a entrar/),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Asignar…" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "Quitar" }),
		).not.toBeInTheDocument();
	});

	it("extension_outdated al leer: pide reiniciar la sesión y no ofrece grabar", async () => {
		m.getShortcuts.mockRejectedValue("extension_outdated");
		render(<ShortcutsCard />);
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Reinicia la sesión para cargar la extensión actualizada",
		);
		expect(
			screen.queryByRole("button", { name: "Asignar…" }),
		).not.toBeInTheDocument();
	});

	it("extension_outdated al asignar muestra el mismo aviso en vez del genérico", async () => {
		m.setShortcut.mockRejectedValue("extension_outdated");
		render(<ShortcutsCard />);
		fireEvent.click(await screen.findByRole("button", { name: "Asignar…" }));
		await act(async () => {});
		expect(
			await screen.findByText(
				"Reinicia la sesión para cargar la extensión actualizada.",
			),
		).toBeInTheDocument();
	});

	it("si no se pueden leer, lo dice y no rompe", async () => {
		m.getShortcuts.mockRejectedValue(new Error("sin backend"));
		render(<ShortcutsCard />);
		expect(
			await screen.findByText(/No se pudieron leer los atajos/),
		).toBeInTheDocument();
	});

	it("sin atajo asignado: «Sin asignar», Asignar… activo y Quitar desactivado", async () => {
		render(<ShortcutsCard />);
		expect(await screen.findByText("Sin asignar")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Asignar…" })).toBeEnabled();
		expect(screen.getByRole("button", { name: "Quitar" })).toBeDisabled();
	});

	it("con atajo: lo muestra como chips con nombre accesible y Quitar lo borra", async () => {
		m.getShortcuts.mockResolvedValue(state(true, "<Super><Shift>c"));
		render(<ShortcutsCard />);
		expect(
			await screen.findByRole("img", { name: "Super + Shift + C" }),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
		await waitFor(() =>
			expect(m.setShortcut).toHaveBeenCalledWith("capture", null),
		);
	});

	it("las acciones futuras salen atenuadas con «Pronto» y sin botones", async () => {
		render(<ShortcutsCard />);
		await screen.findByText("Sin asignar");
		const items = screen.getAllByRole("listitem");
		expect(items).toHaveLength(2);
		for (const li of items) {
			expect(li).toHaveAttribute("aria-disabled", "true");
			expect(li).toHaveTextContent("Pronto");
			expect(li.querySelector("button")).toBeNull();
		}
		expect(screen.getByText("Panel de emojis")).toBeInTheDocument();
		expect(screen.getByText("Portapapeles")).toBeInTheDocument();
	});
});

describe("ShortcutsCard — asignar con la extensión", () => {
	async function openRecorder() {
		render(<ShortcutsCard />);
		fireEvent.click(await screen.findByRole("button", { name: "Asignar…" }));
		await act(async () => {});
	}

	it("Asignar… pide la grabación a la extensión y asigna lo grabado tras comprobar conflictos", async () => {
		await openRecorder();
		expect(m.recordShortcut).toHaveBeenCalledOnce();
		await waitFor(() =>
			expect(m.setShortcut).toHaveBeenCalledWith("capture", "<Control><Alt>k"),
		);
		expect(m.checkShortcutConflicts).toHaveBeenCalledWith("<Control><Alt>k");
		await waitFor(() =>
			expect(
				screen.queryByRole("group", { name: "Asignar atajo" }),
			).not.toBeInTheDocument(),
		);
	});

	it("mientras graba muestra cómo cancelar y no ofrece botones inútiles", async () => {
		m.recordShortcut.mockReturnValue(new Promise(() => {}));
		await openRecorder();
		expect(
			screen.getByRole("group", { name: "Asignar atajo" }),
		).toHaveTextContent("Pulsa la combinación; Esc o un clic cancelan.");
		expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
	});

	it("cancelar en la extensión cierra sin asignar nada", async () => {
		m.recordShortcut.mockResolvedValue({ accel: "", status: "cancelled" });
		await openRecorder();
		expect(
			screen.queryByRole("group", { name: "Asignar atajo" }),
		).not.toBeInTheDocument();
		expect(m.setShortcut).not.toHaveBeenCalled();
	});

	it("con conflicto avisa (role=alert) y pide confirmar antes de asignar", async () => {
		m.checkShortcutConflicts.mockResolvedValue(["Captura de pantalla (GNOME)"]);
		m.recordShortcut.mockResolvedValue({ accel: "<Super>s", status: "ok" });
		await openRecorder();
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Super+S ya lo usa: Captura de pantalla (GNOME)",
		);
		expect(m.setShortcut).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Usar de todos modos" }),
		);
		await waitFor(() =>
			expect(m.setShortcut).toHaveBeenCalledWith("capture", "<Super>s"),
		);
	});

	it("la sugerencia Super+Shift+C nunca se aplica sola; con un clic pasa por la comprobación", async () => {
		render(<ShortcutsCard />);
		const sug = await screen.findByRole("button", {
			name: "Sugerencia: Super+Shift+C",
		});
		expect(m.setShortcut).not.toHaveBeenCalled();
		fireEvent.click(sug);
		await waitFor(() =>
			expect(m.checkShortcutConflicts).toHaveBeenCalledWith("<Super><Shift>c"),
		);
		await waitFor(() =>
			expect(m.setShortcut).toHaveBeenCalledWith("capture", "<Super><Shift>c"),
		);
		expect(m.recordShortcut).not.toHaveBeenCalled();
	});

	it("con un atajo ya asignado no se ofrece la sugerencia", async () => {
		m.getShortcuts.mockResolvedValue(state(true, "<Control>j"));
		render(<ShortcutsCard />);
		await screen.findByRole("img", { name: "Ctrl + J" });
		expect(screen.queryByRole("button", { name: /Sugerencia/ })).toBeNull();
	});

	it("si el backend rechaza el atajo, muestra el motivo", async () => {
		m.setShortcut.mockRejectedValue("reservado por el sistema");
		await openRecorder();
		expect(
			await screen.findByText("reservado por el sistema"),
		).toBeInTheDocument();
	});

	it("extension_inactive al grabar se traduce a una explicación y se puede reintentar", async () => {
		m.recordShortcut.mockRejectedValue("extension_inactive");
		await openRecorder();
		expect(
			await screen.findByText(/La extensión de GNOME Shell no está activa/),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reintentar" }),
		).toBeInTheDocument();
	});

	it("shortcuts_unavailable al grabar: explica que activar la extensión no lo arregla y deja reintentar", async () => {
		m.recordShortcut.mockResolvedValue({
			accel: "<Control><Alt>k",
			status: "ok",
		});
		m.checkShortcutConflicts.mockRejectedValue("shortcuts_unavailable");
		await openRecorder();
		expect(
			await screen.findByText(
				`La extensión no acepta cambios desde esta ventana. Reinicia ${APP_NAME} y cierra la sesión.`,
			),
		).toBeInTheDocument();
		expect(screen.queryByText(/no está activa/)).not.toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Reintentar" }),
		).toBeInTheDocument();
	});

	it("shortcuts_unavailable al asignar: la tarjeta lo muestra como alerta y sigue usable", async () => {
		m.getShortcuts.mockResolvedValue(state(true, "<Control><Alt>j"));
		m.setShortcut.mockRejectedValue("shortcuts_unavailable");
		render(<ShortcutsCard />);
		fireEvent.click(await screen.findByRole("button", { name: "Quitar" }));
		expect(await screen.findByRole("alert")).toHaveTextContent(
			`Reinicia ${APP_NAME} y cierra la sesión`,
		);
		expect(
			screen.getByRole("button", { name: "Asignar…" }),
		).toBeInTheDocument();
	});

	it("get_shortcuts con extension_active:false y sin error explica que la extensión no está activa", async () => {
		m.getShortcuts.mockResolvedValue({
			extension_active: false,
			shortcuts: {},
		});
		render(<ShortcutsCard />);
		expect(await screen.findByText(/aún no está\s+activa/)).toBeInTheDocument();
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	});

	it("la fila no se solapa a 420 px: la columna de chips se encoge y los botones envuelven", async () => {
		m.getShortcuts.mockResolvedValue(state(true, "<Control><Alt><Shift>space"));
		const { container } = render(<ShortcutsCard />);
		await screen.findByRole("img", { name: "Ctrl + Alt + Shift + Espacio" });
		const row = screen
			.getByText("Capturar")
			.closest(".flex-wrap") as HTMLElement;
		expect(row).not.toBeNull();
		expect(screen.getByText("Capturar").parentElement?.className).toMatch(
			/min-w-\[8rem\]/,
		);
		expect(
			screen.getByRole("button", { name: "Asignar…" }).parentElement?.className,
		).toMatch(/shrink-0.*flex-wrap|flex-wrap.*shrink-0/);
		expect(
			container.querySelector("kbd")?.closest("span.flex-wrap"),
		).not.toBeNull();
	});
});
