import { describe, expect, it } from "vitest";
import data from "./emoji-data.json";
import { normalize, searchEmojis } from "./search";
import type { Emoji } from "./types";

const emojis = data as Emoji[];

describe("normalize", () => {
	it("quita tildes, puntuación, mayúsculas y espacios de más", () => {
		expect(normalize(" Bandera:  Árgentina ")).toBe("bandera argentina");
	});
});

describe("searchEmojis", () => {
	it("pone la bandera argentina primero", () => {
		expect(searchEmojis(emojis, "bandera argentina")[0].char).toBe("🇦🇷");
	});

	it("pone el mate primero", () => {
		expect(searchEmojis(emojis, "mate")[0].char).toBe("🧉");
	});

	it.each(["corazon", "risa", "gato", "pizza", "llorar"])(
		"%s encuentra algo relacionado",
		(palabra) => {
			const [primero] = searchEmojis(emojis, palabra);
			const texto = normalize([primero.name, ...primero.keywords].join(" "));
			expect(texto).toContain(palabra);
		},
	);

	it("una consulta vacía no devuelve nada", () => {
		expect(searchEmojis(emojis, "")).toEqual([]);
		expect(searchEmojis(emojis, " : ")).toEqual([]);
	});

	it("mayúsculas y tildes no cambian el resultado", () => {
		expect(searchEmojis(emojis, "CORAZÓN")).toEqual(
			searchEmojis(emojis, "corazon"),
		);
	});

	it("respeta el límite", () => {
		expect(searchEmojis(emojis, "cara", 5)).toHaveLength(5);
		expect(searchEmojis(emojis, "cara").length).toBeLessThanOrEqual(80);
	});

	it("exige todas las palabras de la consulta", () => {
		expect(searchEmojis(emojis, "mate zzzz")).toEqual([]);
	});
});
