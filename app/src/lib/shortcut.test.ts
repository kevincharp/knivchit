import { describe, expect, it } from "vitest";
import {
	acceleratorChips,
	acceleratorLabel,
	SUGGESTED_CAPTURE_ACCEL,
} from "./shortcut";

describe("chips y etiquetas", () => {
	it("<Super><Shift>c → Super, Shift, C", () => {
		expect(acceleratorChips("<Super><Shift>c")).toEqual([
			"Super",
			"Shift",
			"C",
		]);
		expect(acceleratorLabel("<Super><Shift>c")).toBe("Super+Shift+C");
	});

	it("<Control> y <Primary> se muestran como Ctrl; las teclas especiales, en español", () => {
		expect(acceleratorChips("<Control><Alt>space")).toEqual([
			"Ctrl",
			"Alt",
			"Espacio",
		]);
		expect(acceleratorChips("<Primary>Return")).toEqual(["Ctrl", "Enter"]);
		expect(acceleratorChips("<Super>Left")).toEqual(["Super", "←"]);
	});

	it("una tecla F sola", () => {
		expect(acceleratorChips("F9")).toEqual(["F9"]);
	});

	it("vacío, nulo o ausente no tiene chips", () => {
		expect(acceleratorChips("")).toEqual([]);
		expect(acceleratorChips(null)).toEqual([]);
		expect(acceleratorChips(undefined)).toEqual([]);
	});

	it("la sugerencia es Super+Shift+C", () => {
		expect(acceleratorLabel(SUGGESTED_CAPTURE_ACCEL)).toBe("Super+Shift+C");
	});
});
