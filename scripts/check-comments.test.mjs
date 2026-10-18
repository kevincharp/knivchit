import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, MAX_BLOCK, MAX_HEADER } from "./check-comments.mjs";

const block = (n, prefix = "//") => Array.from({ length: n }, (_, i) => `${prefix} línea ${i}`).join("\n");

test("un bloque de comentarios dentro del código en el límite pasa", () => {
	const src = `fn a() {}\n${block(MAX_BLOCK, "///")}\nfn b() {}\n`;
	assert.deepEqual(analyze(src, ".rs"), []);
});

test("un bloque que supera el límite falla y dice dónde empieza", () => {
	const src = `fn a() {}\n${block(MAX_BLOCK + 1, "///")}\nfn b() {}\n`;
	const [v] = analyze(src, ".rs");
	assert.equal(v.kind, "largo");
	assert.equal(v.line, 2);
});

test("la cabecera de un archivo admite más líneas, pero tiene su tope", () => {
	assert.deepEqual(analyze(`${block(MAX_HEADER, "//!")}\nfn a() {}\n`, ".rs"), []);
	assert.equal(analyze(`${block(MAX_HEADER + 1, "//!")}\nfn a() {}\n`, ".rs").length, 1);
});

test("el shebang no cuenta y la cabecera de un script se reconoce", () => {
	assert.deepEqual(analyze(`#!/usr/bin/env bash\n${block(MAX_HEADER, "#")}\nset -e\n`, ".sh"), []);
});

test("un comentario al final de una línea de código no cuenta como bloque", () => {
	const src = Array.from({ length: 30 }, () => "let x = 1; // nota").join("\n");
	assert.deepEqual(analyze(src, ".rs"), []);
});

test("las frases que cuentan la historia del desarrollo fallan", () => {
	for (const frase of [
		"tres workarounds fallaron en la verificación real",
		"HALLAZGO REAL: no se ejercitaba",
		"se sospecha que dispara el artefacto",
		"antes se restauraba si había estado visible",
		"tras la segunda prueba manual",
	]) {
		const [v] = analyze(`fn a() {}\n// ${frase}\nfn b() {}\n`, ".rs");
		assert.equal(v?.kind, "historia", frase);
	}
});

test("explicar el porqué actual no dispara la regla de historia", () => {
	const src = "// La extensión coloca la ventana porque Wayland no deja a la app posicionarse.\nfn a() {}\n";
	assert.deepEqual(analyze(src, ".rs"), []);
});

test("un bloque cuya primera línea dice «check-comments: ignore» queda exento", () => {
	const src = `fn a() {}\n// check-comments: ignore\n${block(MAX_BLOCK + 5, "//")}\nfn b() {}\n`;
	assert.deepEqual(analyze(src, ".rs"), []);
});

test("los tipos de archivo desconocidos se ignoran", () => {
	assert.deepEqual(analyze(block(80), ".md"), []);
});

test("los bloques /** ... */ también cuentan por líneas", () => {
	const doc = `/**\n${Array.from({ length: MAX_BLOCK + 2 }, (_, i) => ` * línea ${i}`).join("\n")}\n */`;
	const [v] = analyze(`export const a = 1;\n${doc}\nexport function b() {}\n`, ".ts");
	assert.equal(v?.kind, "largo");
});

test("una desreferencia al inicio de línea no es un comentario", () => {
	const src = Array.from({ length: 30 }, () => "*count += 1;").join("\n");
	assert.deepEqual(analyze(src, ".rs"), []);
});

test("la frase «sospechar» se detecta también dentro de un /** */", () => {
	const [v] = analyze("/**\n * se añadieron al sospechar un problema\n */\nexport const a = 1;\n", ".ts");
	assert.equal(v?.kind, "historia");
});
