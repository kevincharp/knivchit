import { beforeEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
	close: vi.fn().mockResolvedValue(undefined),
	minimize: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => win }));
vi.mock("@tauri-apps/api/app", () => ({
	getVersion: vi.fn().mockResolvedValue("0.1.0"),
}));
vi.mock("@tauri-apps/api/path", () => ({
	homeDir: vi.fn().mockResolvedValue("/home/u/"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
	openPath: vi.fn().mockResolvedValue(undefined),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	cancelCapture,
	captureErrorCode,
	checkForUpdate,
	checkShortcutConflicts,
	chooseSaveDir,
	closeCurrentWindow,
	closePin,
	copyCapture,
	getAppVersion,
	getAutostart,
	getCapturePermission,
	getCapturePreview,
	getIntegrationStatus,
	getPanelIcon,
	getPinImage,
	getSettings,
	getShortcuts,
	minimizeCurrentWindow,
	onCapturePermissionChanged,
	openSaveDir,
	pinCapture,
	quitApp,
	recordShortcut,
	requestCapturePermission,
	saveCapture,
	saveCaptureAs,
	setAutostart,
	setPanelIcon,
	setShortcut,
	startCapture,
	updateSettings,
} from "./tauri";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
	invokeMock.mockReset();
	invokeMock.mockResolvedValue(undefined);
});

describe("contrato de lib/tauri.ts (comandos existentes)", () => {
	it("startCapture invoca start_capture sin argumentos", async () => {
		await startCapture();
		expect(invokeMock).toHaveBeenCalledWith("start_capture");
	});

	it("getCapturePreview invoca get_capture_preview y devuelve el data URL", async () => {
		invokeMock.mockResolvedValue("data:image/png;base64,AAAA");
		await expect(getCapturePreview()).resolves.toBe(
			"data:image/png;base64,AAAA",
		);
		expect(invokeMock).toHaveBeenCalledWith("get_capture_preview");
	});

	it("cancelCapture invoca cancel_capture sin argumentos", async () => {
		await cancelCapture();
		expect(invokeMock).toHaveBeenCalledWith("cancel_capture");
	});

	it("getSettings invoca get_settings", async () => {
		await getSettings();
		expect(invokeMock).toHaveBeenCalledWith("get_settings");
	});

	it("updateSettings envía el objeto bajo la clave settings", async () => {
		const settings = {
			screenshot_save_dir: "~/Pictures",
			clipboard_cap_count: 100,
			clipboard_cap_days: 30,
			sensitive_exclude_enabled: true,
		};
		await updateSettings(settings);
		expect(invokeMock).toHaveBeenCalledWith("update_settings", { settings });
	});
});

describe("contrato de lib/tauri.ts (comandos de captura)", () => {
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

	it("saveCapture envía solo los bytes como cuerpo, sin cabecera de carpeta", async () => {
		invokeMock.mockResolvedValue(
			"/home/u/Pictures/knivchit-20261013-120000.png",
		);
		const ruta = await saveCapture(png);
		expect(ruta).toBe("/home/u/Pictures/knivchit-20261013-120000.png");
		expect(invokeMock).toHaveBeenCalledWith("save_capture", png);
	});

	it("copyCapture envía solo los bytes", async () => {
		await copyCapture(png);
		expect(invokeMock).toHaveBeenCalledWith("copy_capture", png);
	});

	it("saveCaptureAs envía solo los bytes y devuelve la ruta elegida", async () => {
		invokeMock.mockResolvedValue("/home/u/Pictures/elegida.png");
		await expect(saveCaptureAs(png)).resolves.toBe(
			"/home/u/Pictures/elegida.png",
		);
		expect(invokeMock).toHaveBeenCalledWith("save_capture_as", png);
	});

	it("saveCaptureAs devuelve null si el usuario cancela el diálogo", async () => {
		invokeMock.mockResolvedValue(null);
		await expect(saveCaptureAs(png)).resolves.toBeNull();
	});

	it("pinCapture envía los bytes y x-width/x-height redondeados como texto", async () => {
		invokeMock.mockResolvedValue("pin-123");
		await expect(pinCapture(png, 320.4, 200.6)).resolves.toBe("pin-123");
		expect(invokeMock).toHaveBeenCalledWith("pin_capture", png, {
			headers: { "x-width": "320", "x-height": "201" },
		});
	});

	it("getPinImage y closePin envían el label", async () => {
		invokeMock.mockResolvedValue("data:image/png;base64,AAAA");
		await getPinImage("pin-abc");
		expect(invokeMock).toHaveBeenCalledWith("get_pin_image", {
			label: "pin-abc",
		});
		await closePin("pin-abc");
		expect(invokeMock).toHaveBeenCalledWith("close_pin", { label: "pin-abc" });
	});

	it("propaga el error del backend sin tragarlo", async () => {
		invokeMock.mockRejectedValue("no es un PNG");
		await expect(saveCapture(png)).rejects.toBe("no es un PNG");
		await expect(copyCapture(png)).rejects.toBe("no es un PNG");
		await expect(pinCapture(png, 1, 1)).rejects.toBe("no es un PNG");
	});
});

describe("controles de la ventana principal", () => {
	it("closeCurrentWindow cierra la ventana actual, sin invoke", async () => {
		await closeCurrentWindow();
		expect(win.close).toHaveBeenCalledOnce();
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("minimizeCurrentWindow minimiza la ventana actual", async () => {
		await minimizeCurrentWindow();
		expect(win.minimize).toHaveBeenCalledOnce();
	});
});

describe("contrato del hub", () => {
	it("getIntegrationStatus invoca get_integration_status", async () => {
		invokeMock.mockResolvedValue({ extension_active: true });
		expect(await getIntegrationStatus()).toEqual({ extension_active: true });
		expect(invokeMock).toHaveBeenCalledWith("get_integration_status");
	});

	it("chooseSaveDir devuelve la ruta o null si se cancela", async () => {
		invokeMock.mockResolvedValue(null);
		expect(await chooseSaveDir()).toBeNull();
		expect(invokeMock).toHaveBeenCalledWith("choose_save_dir");
	});

	it("getAutostart y setAutostart({enabled}) respetan el contrato", async () => {
		invokeMock.mockResolvedValue(true);
		expect(await getAutostart()).toBe(true);
		await setAutostart(false);
		expect(invokeMock).toHaveBeenLastCalledWith("set_autostart", {
			enabled: false,
		});
	});

	it("checkForUpdate invoca check_for_update y getAppVersion lee la versión", async () => {
		invokeMock.mockResolvedValue({
			has_update: false,
			latest_version: "0.1.0",
		});
		expect((await checkForUpdate()).has_update).toBe(false);
		expect(invokeMock).toHaveBeenCalledWith("check_for_update");
		expect(await getAppVersion()).toBe("0.1.0");
	});

	it("openSaveDir invoca open_save_dir sin argumentos", async () => {
		await openSaveDir();
		expect(invokeMock).toHaveBeenCalledWith("open_save_dir");
	});
});

describe("contrato de atajos", () => {
	it("getShortcuts invoca get_shortcuts", async () => {
		invokeMock.mockResolvedValue({
			extension_active: true,
			shortcuts: { capture: "<Super><Shift>c" },
		});
		expect((await getShortcuts()).shortcuts.capture).toBe("<Super><Shift>c");
		expect(invokeMock).toHaveBeenCalledWith("get_shortcuts");
	});

	it("setShortcut manda {action, accel} y null se envía como cadena vacía", async () => {
		await setShortcut("capture", "<Super><Shift>c");
		expect(invokeMock).toHaveBeenLastCalledWith("set_shortcut", {
			action: "capture",
			accel: "<Super><Shift>c",
		});
		await setShortcut("capture", null);
		expect(invokeMock).toHaveBeenLastCalledWith("set_shortcut", {
			action: "capture",
			accel: "",
		});
	});

	it("checkShortcutConflicts manda {accel} y devuelve los textos", async () => {
		invokeMock.mockResolvedValue(["Captura de pantalla (GNOME)"]);
		expect(await checkShortcutConflicts("<Super>s")).toEqual([
			"Captura de pantalla (GNOME)",
		]);
		expect(invokeMock).toHaveBeenCalledWith("check_shortcut_conflicts", {
			accel: "<Super>s",
		});
	});
});

describe("grabación de atajos por la extensión", () => {
	it("recordShortcut invoca record_shortcut y devuelve estado y acelerador", async () => {
		invokeMock.mockResolvedValue({ accel: "<Super><Shift>c", status: "ok" });
		expect(await recordShortcut()).toEqual({
			accel: "<Super><Shift>c",
			status: "ok",
		});
		expect(invokeMock).toHaveBeenCalledWith("record_shortcut");
	});
});

describe("icono de la barra superior y salir", () => {
	it("getPanelIcon pide get_panel_icon y devuelve {extension_active, enabled}", async () => {
		invokeMock.mockResolvedValue({ extension_active: true, enabled: false });
		expect(await getPanelIcon()).toEqual({
			extension_active: true,
			enabled: false,
		});
		expect(invokeMock).toHaveBeenLastCalledWith("get_panel_icon");
	});

	it("setPanelIcon envía {enabled} tal cual", async () => {
		invokeMock.mockResolvedValue(undefined);
		await setPanelIcon(true);
		expect(invokeMock).toHaveBeenLastCalledWith("set_panel_icon", {
			enabled: true,
		});
		await setPanelIcon(false);
		expect(invokeMock).toHaveBeenLastCalledWith("set_panel_icon", {
			enabled: false,
		});
	});

	it.each([
		"extension_inactive",
		"shortcuts_unavailable",
		"extension_outdated",
	])("setPanelIcon propaga el rechazo «%s» sin tragarlo", async (code) => {
		invokeMock.mockRejectedValue(code);
		await expect(setPanelIcon(true)).rejects.toBe(code);
	});

	it("quitApp invoca quit_app sin argumentos", async () => {
		invokeMock.mockResolvedValue(undefined);
		await quitApp();
		expect(invokeMock).toHaveBeenLastCalledWith("quit_app");
	});
});

describe("permiso de captura", () => {
	it("getCapturePermission pide get_capture_permission y devuelve {granted, last_error}", async () => {
		invokeMock.mockResolvedValue({ granted: false, last_error: "denied" });
		expect(await getCapturePermission()).toEqual({
			granted: false,
			last_error: "denied",
		});
		expect(invokeMock).toHaveBeenLastCalledWith("get_capture_permission");
	});

	it("requestCapturePermission invoca request_capture_permission sin argumentos y propaga el código", async () => {
		invokeMock.mockResolvedValue(undefined);
		await requestCapturePermission();
		expect(invokeMock).toHaveBeenLastCalledWith("request_capture_permission");
		invokeMock.mockRejectedValue("cancelled");
		await expect(requestCapturePermission()).rejects.toBe("cancelled");
	});

	it("onCapturePermissionChanged escucha «capture-permission-changed» y entrega el payload", async () => {
		const unlisten = vi.fn();
		vi.mocked(listen).mockResolvedValue(unlisten);
		const seen: unknown[] = [];
		const stop = await onCapturePermissionChanged((s) => seen.push(s));
		expect(listen).toHaveBeenCalledWith(
			"capture-permission-changed",
			expect.any(Function),
		);
		const handler = vi.mocked(listen).mock.calls[0][1] as (e: {
			payload: unknown;
		}) => void;
		handler({ payload: { granted: true, last_error: null } });
		expect(seen).toEqual([{ granted: true, last_error: null }]);
		expect(stop).toBe(unlisten);
	});

	it.each([
		["needs_permission", "needs_permission"],
		["cancelled", "cancelled"],
		["denied", "denied"],
		["portal_unavailable", "portal_unavailable"],
		[new Error("denied"), "denied"],
		["Portal request didn't succeed", null],
		["", null],
	])("captureErrorCode(%j) → %j", (input, expected) => {
		expect(captureErrorCode(input)).toBe(expected);
	});
});
