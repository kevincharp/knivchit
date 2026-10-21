import type { KeyboardEvent } from "react";

interface PickerKeys {
	query: string;
	onClearQuery: () => void;
	onClose: () => void;
	onSwitchTab: () => void;
}

/** Teclas del panel que valen en cualquier zona: Esc (borra, luego cierra) y Ctrl+Tab (cambia de pestaña). */
export function usePickerKeys({
	query,
	onClearQuery,
	onClose,
	onSwitchTab,
}: PickerKeys) {
	return (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			if (query) onClearQuery();
			else onClose();
		} else if (e.key === "Tab" && e.ctrlKey) {
			e.preventDefault();
			onSwitchTab();
		}
	};
}
