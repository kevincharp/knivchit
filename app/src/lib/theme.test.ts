import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (e: { matches: boolean }) => void;

/** matchMedia controlable: permite simular el cambio de preferencia de GNOME. */
function mockMatchMedia(initialDark: boolean) {
	let dark = initialDark;
	const listeners = new Set<Listener>();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			get matches() {
				return dark;
			},
			addEventListener: (_: string, l: Listener) => listeners.add(l),
			removeEventListener: (_: string, l: Listener) => listeners.delete(l),
		})),
	);
	return {
		set(next: boolean) {
			dark = next;
			for (const l of listeners) l({ matches: next });
		},
	};
}

const attr = () => document.documentElement.getAttribute("data-theme");

beforeEach(() => {
	vi.resetModules();
	localStorage.clear();
	document.documentElement.removeAttribute("data-theme");
});
afterEach(() => vi.unstubAllGlobals());

async function load() {
	return import("./theme");
}

describe("tema", () => {
	it("sin elección guardada es «Sistema» y sigue la preferencia del sistema", async () => {
		mockMatchMedia(false);
		const t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("system");
		expect(attr()).toBe("light");
	});

	it("«Sistema» con preferencia oscura aplica data-theme=dark", async () => {
		mockMatchMedia(true);
		const t = await load();
		t.initTheme();
		expect(attr()).toBe("dark");
	});

	it("«Sistema» reacciona en vivo al cambio de prefers-color-scheme", async () => {
		const mq = mockMatchMedia(true);
		const t = await load();
		t.initTheme();
		mq.set(false);
		expect(attr()).toBe("light");
		mq.set(true);
		expect(attr()).toBe("dark");
	});

	it("Oscuro y Claro ignoran la preferencia del sistema", async () => {
		const mq = mockMatchMedia(true);
		const t = await load();
		t.initTheme();
		t.setThemeChoice("light");
		expect(attr()).toBe("light");
		mq.set(false);
		mq.set(true);
		expect(attr()).toBe("light");
		t.setThemeChoice("dark");
		mq.set(false);
		expect(attr()).toBe("dark");
	});

	it("persiste la elección en localStorage y la recupera al iniciar", async () => {
		mockMatchMedia(false);
		let t = await load();
		t.initTheme();
		t.setThemeChoice("dark");
		expect(localStorage.getItem("knivchit-theme")).toBe("dark");

		vi.resetModules();
		document.documentElement.removeAttribute("data-theme");
		t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("dark");
		expect(attr()).toBe("dark");
	});

	it("migra una sola vez la elección guardada con la clave vieja viewclip-theme", async () => {
		mockMatchMedia(false);
		localStorage.setItem("viewclip-theme", "dark");
		const t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("dark");
		expect(localStorage.getItem("knivchit-theme")).toBe("dark");
		// Ya migrada: cambiar la clave vieja después no afecta.
		localStorage.setItem("viewclip-theme", "light");
		vi.resetModules();
		const t2 = await load();
		t2.initTheme();
		expect(t2.getThemeChoice()).toBe("dark");
	});

	it("la clave nueva manda sobre la vieja", async () => {
		mockMatchMedia(false);
		localStorage.setItem("knivchit-theme", "light");
		localStorage.setItem("viewclip-theme", "dark");
		const t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("light");
	});

	it("una clave vieja inválida no se migra", async () => {
		mockMatchMedia(false);
		localStorage.setItem("viewclip-theme", "rosa");
		const t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("system");
		expect(localStorage.getItem("knivchit-theme")).toBeNull();
	});

	it("un valor guardado inválido cae a «Sistema»", async () => {
		mockMatchMedia(false);
		localStorage.setItem("knivchit-theme", "rosa");
		const t = await load();
		t.initTheme();
		expect(t.getThemeChoice()).toBe("system");
	});

	it("si localStorage falla, igual funciona durante la sesión", async () => {
		mockMatchMedia(false);
		const t = await load();
		t.initTheme();
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("bloqueado");
		});
		expect(() => t.setThemeChoice("dark")).not.toThrow();
		expect(attr()).toBe("dark");
		vi.restoreAllMocks();
	});

	it("notifica a los suscriptores y deja de hacerlo al cancelar", async () => {
		mockMatchMedia(false);
		const t = await load();
		t.initTheme();
		const fn = vi.fn();
		const off = t.subscribeTheme(fn);
		t.setThemeChoice("dark");
		expect(fn).toHaveBeenCalledOnce();
		off();
		t.setThemeChoice("light");
		expect(fn).toHaveBeenCalledOnce();
	});

	it("solo la ventana principal lleva tema; overlay y pin no", async () => {
		const t = await load();
		expect(t.shouldApplyTheme("")).toBe(true);
		expect(t.shouldApplyTheme("?window=capture-overlay")).toBe(false);
		expect(t.shouldApplyTheme("?window=pin&label=pin-1")).toBe(false);
	});
});
