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
	startCapture: vi.fn(),
	getCapturePermission: vi.fn(),
	requestCapturePermission: vi.fn(),
	onCapturePermissionChanged: vi.fn(),
	getSettings: vi.fn(),
	getIntegrationStatus: vi.fn(),
	getShortcuts: vi.fn(),
	closeCurrentWindow: vi.fn(),
	minimizeCurrentWindow: vi.fn(),
}));
vi.mock("../../lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../lib/tauri")>()),
	...m,
}));

import type { CapturePermissionState } from "../../lib/tauri";
import { AppShell } from "./AppShell";
import {
	CANCELLED_MESSAGE,
	DENIED_MESSAGE,
	ERROR_MESSAGE,
	PENDING_MESSAGE,
	RESET_COMMAND,
	UNAVAILABLE_MESSAGE,
} from "./CapturePermissionNotice";
import { FEATURES } from "./features";

/** Entrega manual de los eventos «capture-permission-changed» del backend. */
let emit: (s: CapturePermissionState) => void = () => {};
const unlisten = vi.fn();

const NEEDS = { granted: false, last_error: null } as const;
const permitir = () =>
	screen.queryByRole("button", { name: "Permitir capturas" });
const RAW =
	/Portal request|didn't succeed|no information|needs_permission|portal_unavailable/;

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	unlisten.mockReset();
	m.startCapture.mockResolvedValue(undefined);
	m.getCapturePermission.mockResolvedValue({ granted: true, last_error: null });
	m.requestCapturePermission.mockResolvedValue(undefined);
	m.onCapturePermissionChanged.mockImplementation(async (cb) => {
		emit = cb;
		return unlisten;
	});
	m.getSettings.mockResolvedValue({
		screenshot_save_dir: "/home/u/Capturas",
		clipboard_cap_count: 100,
		clipboard_cap_days: 30,
		sensitive_exclude_enabled: true,
	});
	m.getIntegrationStatus.mockResolvedValue({ extension_active: true });
	m.getShortcuts.mockResolvedValue({ extension_active: true, shortcuts: {} });
});
afterEach(cleanup);

async function mount(state?: CapturePermissionState | "error" | "pending") {
	if (state === "error")
		m.getCapturePermission.mockRejectedValue("fallo interno");
	else if (state === "pending")
		m.getCapturePermission.mockReturnValue(new Promise(() => {}));
	else if (state) m.getCapturePermission.mockResolvedValue(state);
	render(<AppShell features={FEATURES} />);
	await act(async () => {});
}

describe("permiso de captura — estados de la tarjeta de Inicio", () => {
	it("cargando: sin aviso ni botón", async () => {
		await mount("pending");
		expect(permitir()).toBeNull();
		expect(screen.queryByText(PENDING_MESSAGE)).toBeNull();
		expect(screen.getByRole("button", { name: "Capturar" })).toBeEnabled();
	});

	it("concedido: sin aviso", async () => {
		await mount({ granted: true, last_error: null });
		expect(permitir()).toBeNull();
		expect(screen.queryByText(PENDING_MESSAGE)).toBeNull();
	});

	it("pendiente: aviso amable (role=status) y botón primario «Permitir capturas»", async () => {
		await mount(NEEDS);
		expect(screen.getByText(PENDING_MESSAGE)).toBeInTheDocument();
		expect(screen.getByText(PENDING_MESSAGE).getAttribute("role")).toBe(
			"status",
		);
		expect(permitir()).toBeEnabled();
		// «Capturar» sigue disponible
		expect(screen.getByRole("button", { name: "Capturar" })).toBeEnabled();
	});

	it("«Permitir capturas» pide el permiso; al concederse el aviso desaparece", async () => {
		await mount(NEEDS);
		fireEvent.click(permitir() as HTMLElement);
		await waitFor(() =>
			expect(m.requestCapturePermission).toHaveBeenCalledOnce(),
		);
		await waitFor(() => expect(permitir()).toBeNull());
		expect(screen.queryByText(PENDING_MESSAGE)).toBeNull();
	});

	it("mientras el aviso del portal está abierto, el botón no admite otra pulsación", async () => {
		let resolver: () => void = () => {};
		m.requestCapturePermission.mockImplementation(
			() => new Promise<void>((r) => (resolver = r)),
		);
		await mount(NEEDS);
		const boton = permitir() as HTMLElement;
		fireEvent.click(boton);
		fireEvent.click(boton);
		expect(m.requestCapturePermission).toHaveBeenCalledTimes(1);
		expect(boton).toBeDisabled();
		await act(async () => resolver());
		await waitFor(() => expect(permitir()).toBeNull());
	});

	it("si el backend responde «busy» (ya hay una petición en curso), no cambia el estado ni muestra error", async () => {
		m.requestCapturePermission.mockRejectedValueOnce("busy");
		await mount(NEEDS);
		fireEvent.click(permitir() as HTMLElement);
		await waitFor(() =>
			expect(m.requestCapturePermission).toHaveBeenCalledOnce(),
		);
		await waitFor(() => expect(permitir()).toBeEnabled());
		expect(screen.getByText(PENDING_MESSAGE)).toBeInTheDocument();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(document.body.textContent).not.toMatch(/busy/);
	});

	it("denegado: alerta con el comando de restablecer en un bloque de código copiable", async () => {
		await mount({ granted: false, last_error: "denied" });
		const aviso = screen.getByText(DENIED_MESSAGE);
		expect(aviso.getAttribute("role")).toBe("alert");
		expect(RESET_COMMAND).toBe("flatpak permission-reset knivchit");
		const code = screen.getByText(RESET_COMMAND);
		expect(code.tagName).toBe("CODE");
		expect(code.closest("pre")).not.toBeNull();
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		fireEvent.click(screen.getByRole("button", { name: "Copiar el comando" }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(RESET_COMMAND));
		expect(
			await screen.findByRole("button", { name: "Copiar el comando" }),
		).toHaveTextContent("Copiado");
		expect(permitir()).toBeEnabled();
	});

	it("cancelado: «Captura cancelada.» sin alarma (status, no alert) y se puede volver a pedir", async () => {
		await mount({ granted: false, last_error: "cancelled" });
		const aviso = screen.getByText(CANCELLED_MESSAGE);
		expect(aviso.getAttribute("role")).toBe("status");
		expect(screen.queryByRole("alert")).toBeNull();
		expect(permitir()).toBeEnabled();
	});

	it("portal ausente: explicación breve (alert) y sin botón que no podría ayudar", async () => {
		await mount({ granted: false, last_error: "portal_unavailable" });
		expect(screen.getByText(UNAVAILABLE_MESSAGE).getAttribute("role")).toBe(
			"alert",
		);
		expect(permitir()).toBeNull();
	});

	it("error al comprobar: aviso neutro (alert) y la posibilidad de pedirlo", async () => {
		await mount("error");
		expect(screen.getByText(ERROR_MESSAGE).getAttribute("role")).toBe("alert");
		expect(permitir()).toBeEnabled();
		expect(screen.queryByText(/fallo interno/)).toBeNull();
	});
});

describe("permiso de captura — pulsar «Capturar» sin permiso", () => {
	it.each([
		["needs_permission", PENDING_MESSAGE],
		["denied", DENIED_MESSAGE],
		["cancelled", CANCELLED_MESSAGE],
		["portal_unavailable", UNAVAILABLE_MESSAGE],
	])(
		"el rechazo «%s» se explica con su aviso, no con el código",
		async (code, texto) => {
			await mount({ granted: true, last_error: null });
			m.startCapture.mockRejectedValueOnce(code);
			fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
			expect(await screen.findByText(texto)).toBeInTheDocument();
			expect(document.body.textContent).not.toMatch(RAW);
			// el botón vuelve a estar disponible tras fallar
			await waitFor(() =>
				expect(screen.getByRole("button", { name: "Capturar" })).toBeEnabled(),
			);
		},
	);

	it("un fallo cualquiera del portal NUNCA enseña el texto crudo", async () => {
		await mount();
		m.startCapture.mockRejectedValueOnce(
			"el portal devolvió un error: Portal request didn't succeed with no information",
		);
		fireEvent.click(screen.getByRole("button", { name: "Capturar" }));
		expect(
			await screen.findByText(
				"No se pudo iniciar la captura. Inténtalo de nuevo.",
			),
		).toBeInTheDocument();
		expect(document.body.textContent).not.toMatch(RAW);
	});
});

describe("permiso de captura — eventos del backend (sin polling)", () => {
	it("el atajo pulsado sin permiso: el evento muestra el aviso al instante", async () => {
		await mount({ granted: true, last_error: null });
		expect(permitir()).toBeNull();
		act(() => emit({ granted: false, last_error: "needs_permission" }));
		expect(screen.getByText(PENDING_MESSAGE)).toBeInTheDocument();
		expect(permitir()).toBeEnabled();
	});

	it("otro evento lo actualiza (denegado) y uno de concedido lo quita", async () => {
		await mount(NEEDS);
		act(() => emit({ granted: false, last_error: "denied" }));
		expect(screen.getByText(DENIED_MESSAGE)).toBeInTheDocument();
		act(() => emit({ granted: true, last_error: null }));
		expect(screen.queryByText(DENIED_MESSAGE)).toBeNull();
		expect(permitir()).toBeNull();
	});

	it("lee el estado una vez y escucha eventos; al desmontar cancela la escucha", async () => {
		await mount();
		expect(m.getCapturePermission).toHaveBeenCalledTimes(1);
		expect(m.onCapturePermissionChanged).toHaveBeenCalledTimes(1);
		cleanup();
		expect(unlisten).toHaveBeenCalledTimes(1);
	});

	it("ningún estado enseña códigos ni texto técnico", async () => {
		for (const last_error of [
			"denied",
			"cancelled",
			"portal_unavailable",
			null,
		] as const) {
			cleanup();
			await mount({ granted: false, last_error });
			expect(document.body.textContent).not.toMatch(RAW);
		}
	});
});
