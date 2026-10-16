export type ThemeChoice = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "knivchit-theme";
/** Clave de cuando el producto se llamaba ViewClip: se lee una sola vez para migrar (renombrado a Knivchit). */
export const LEGACY_THEME_STORAGE_KEY = "viewclip-theme";
const CHOICES: ThemeChoice[] = ["system", "dark", "light"];
const QUERY = "(prefers-color-scheme: dark)";

function isChoice(v: unknown): v is ThemeChoice {
	return CHOICES.includes(v as ThemeChoice);
}

/** Solo la ventana principal (sin `?window=`) lleva tema; overlay y pin quedan como están. */
export function shouldApplyTheme(search: string): boolean {
	return !new URLSearchParams(search).has("window");
}

export function readThemeChoice(): ThemeChoice {
	try {
		const v = localStorage.getItem(THEME_STORAGE_KEY);
		if (isChoice(v)) return v;
		if (v === null) {
			// Migración única: sin clave nueva, se adopta la elección guardada con el nombre viejo.
			const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
			if (isChoice(legacy)) {
				localStorage.setItem(THEME_STORAGE_KEY, legacy);
				return legacy;
			}
		}
		return "system";
	} catch {
		return "system";
	}
}

function prefersDark(): boolean {
	return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
	if (choice === "system") return prefersDark() ? "dark" : "light";
	return choice;
}

let choice: ThemeChoice = "system";
let started = false;
const listeners = new Set<() => void>();

function apply() {
	document.documentElement.setAttribute("data-theme", resolveTheme(choice));
	for (const l of listeners) l();
}

/** Lee la elección guardada, aplica el tema y sigue los cambios de GNOME mientras sea «Sistema». */
export function initTheme(): void {
	choice = readThemeChoice();
	apply();
	if (started || typeof matchMedia !== "function") return;
	started = true;
	matchMedia(QUERY).addEventListener("change", () => {
		if (choice === "system") apply();
	});
}

export function getThemeChoice(): ThemeChoice {
	return choice;
}

export function setThemeChoice(next: ThemeChoice): void {
	choice = next;
	try {
		localStorage.setItem(THEME_STORAGE_KEY, next);
	} catch {
		// Sin almacenamiento: el tema vale para esta sesión.
	}
	apply();
}

export function subscribeTheme(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
