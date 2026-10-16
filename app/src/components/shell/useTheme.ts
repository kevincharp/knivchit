import { useSyncExternalStore } from "react";
import {
	getThemeChoice,
	setThemeChoice,
	subscribeTheme,
} from "../../lib/theme";

/** Elección de tema (Sistema, Oscuro, Claro) y su setter, sincronizados con lib/theme. */
export function useTheme() {
	const choice = useSyncExternalStore(subscribeTheme, getThemeChoice);
	return { choice, setChoice: setThemeChoice };
}
