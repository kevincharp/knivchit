import { describe, expect, it } from "vitest";
import { createRecents } from "./recents";

describe("createRecents", () => {
	it("pone el último elegido al frente", () => {
		const recents = createRecents();
		recents.push("😀");
		recents.push("🧉");
		expect(recents.list()).toEqual(["🧉", "😀"]);
	});

	it("repetir uno lo mueve al frente sin duplicarlo", () => {
		const recents = createRecents();
		for (const char of ["😀", "🧉", "😀"]) recents.push(char);
		expect(recents.list()).toEqual(["😀", "🧉"]);
	});

	it("no supera el máximo", () => {
		const recents = createRecents(2);
		for (const char of ["😀", "🧉", "🇦🇷"]) recents.push(char);
		expect(recents.list()).toEqual(["🇦🇷", "🧉"]);
	});

	it("el máximo por defecto es 16", () => {
		const recents = createRecents();
		for (let i = 0; i < 20; i++) recents.push(String(i));
		expect(recents.list()).toHaveLength(16);
	});

	it("list devuelve una copia", () => {
		const recents = createRecents();
		recents.push("😀");
		recents.list().push("🧉");
		expect(recents.list()).toEqual(["😀"]);
	});
});
