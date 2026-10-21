import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const aquí = import.meta.dirname;
const fixtures = join(aquí, "fixtures", "emoji");

function generar() {
	const salida = join(mkdtempSync(join(tmpdir(), "emoji-")), "emoji-data.json");
	execFileSync("node", [
		join(aquí, "generate-emoji-data.mjs"),
		"--emoji-test",
		join(fixtures, "emoji-test.txt"),
		"--annotations",
		join(fixtures, "es.xml"),
		"--annotations-derived",
		join(fixtures, "es-derived.xml"),
		"--out",
		salida,
	]);
	return JSON.parse(readFileSync(salida, "utf8"));
}

const porChar = (datos, char) => datos.find((e) => e.char === char);

test("conserva las secuencias compuestas carácter por carácter", () => {
	const datos = generar();
	assert.ok(porChar(datos, "👨‍👩‍👧‍👦"));
	assert.ok(porChar(datos, "🇦🇷"));
	assert.ok(porChar(datos, "❤️"));
});

test("solo entradas fully-qualified y sin componentes", () => {
	const chars = generar().map((e) => e.char);
	assert.deepEqual(chars, ["😀", "👍", "👨‍👩‍👧‍👦", "🫠", "❤️", "🇦🇷"]);
});

test("colapsa los tonos de piel a la base", () => {
	const datos = generar();
	assert.equal(porChar(datos, "👍").hasTones, true);
	assert.equal(porChar(datos, "😀").hasTones, false);
	assert.equal(porChar(datos, "👍🏽"), undefined);
});

test("nombre y palabras clave salen de las anotaciones en español", () => {
	const datos = generar();
	assert.deepEqual(porChar(datos, "😀"), {
		char: "😀",
		name: "cara sonriendo",
		keywords: ["cara", "feliz", "sonrisa"],
		group: "Smileys & Emotion",
		hasTones: false,
	});
	assert.equal(porChar(datos, "❤️").name, "corazón rojo");
	assert.deepEqual(porChar(datos, "👍").keywords, ["bien", "pulgar", '"ok"']);
	assert.equal(porChar(datos, "🇦🇷").name, "Bandera: Argentina");
});

test("sin anotación, el nombre cae al inglés y no hay palabras clave", () => {
	const e = porChar(generar(), "🫠");
	assert.equal(e.name, "melting face");
	assert.deepEqual(e.keywords, []);
});
