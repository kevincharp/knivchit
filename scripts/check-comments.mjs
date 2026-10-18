#!/usr/bin/env node
// Comprueba que los comentarios sigan siendo cortos y sin historia (regla 8 de CLAUDE.local.md).
// Falla si hay un bloque de comentarios de línea completa demasiado largo, o una frase que delata
// relato de intentos descartados. Sin dependencias; solo mira archivos versionados por git.
//
// Escape: si la primera línea del bloque contiene `check-comments: ignore`, el bloque queda exento.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_BLOCK = 12; // líneas seguidas dentro del código
export const MAX_HEADER = 30; // cabecera de archivo (documentación de módulo o uso de un script)

// Frases que cuentan la historia del desarrollo en vez de explicar el porqué.
export const HISTORY = [
	/\bfallaron\b/i,
	/\bworkarounds?\b/i,
	/\bHALLAZGO\b/,
	/\bsospech(a|ar|ó)\b/i,
	/\bfalta confirmarlo\b/i,
	/\b(primera|segunda) prueba (real|manual)\b/i,
	/\bcomprobado en un Shell\b/i,
	/\bantes se (restauraba|usaba|hacía|llamaba)\b/i,
	/\bdentro de esta misma épica\b/i,
];

const MARKERS = { ".rs": "//", ".ts": "//", ".tsx": "//", ".js": "//", ".mjs": "//", ".sh": "#" };
const IGNORE = "check-comments: ignore";

/** Devuelve las infracciones de un texto: `{ line, kind, detail }`. */
export function analyze(text, ext) {
	const marker = MARKERS[ext];
	if (!marker) return [];
	const lines = text.split("\n");
	const found = [];
	let start = -1;
	const close = (end) => {
		if (start < 0) return;
		const n = end - start;
		const ignored = lines[start].includes(IGNORE);
		// Cabecera de archivo: antes del bloque solo hay líneas en blanco o el shebang.
		const header = lines.slice(0, start).every((l) => l.trim() === "" || l.startsWith("#!"));
		const limit = header ? MAX_HEADER : MAX_BLOCK;
		if (!ignored && n > limit) found.push({ line: start + 1, kind: "largo", detail: `${n} líneas seguidas (máximo ${limit})` });
		start = -1;
	};
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		// Comentario de línea completa; en los lenguajes con `/** … */`, también sus líneas
		// (`/*`, ` * texto`, `*/`). `*x = 1;` (desreferencia) no lleva espacio tras el `*`.
		const inBlock = marker === "//" && (t.startsWith("/*") || /^\*(\s|\/|$)/.test(t));
		const isComment = (t.startsWith(marker) && !(ext === ".sh" && t.startsWith("#!"))) || inBlock;
		if (isComment) {
			if (start < 0) start = i;
			for (const re of HISTORY) {
				if (re.test(t) && !t.includes(IGNORE)) found.push({ line: i + 1, kind: "historia", detail: t.slice(0, 90) });
			}
		} else {
			close(i);
		}
	}
	close(lines.length);
	return found;
}

function main() {
	const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
	let bad = 0;
	for (const f of files) {
		const ext = f.slice(f.lastIndexOf("."));
		if (!(ext in MARKERS) || f.startsWith("landing/site/")) continue;
		for (const v of analyze(readFileSync(f, "utf8"), ext)) {
			bad++;
			console.error(`${f}:${v.line}  [${v.kind}] ${v.detail}`);
		}
	}
	if (bad) {
		console.error(`\n${bad} infracción(es). Un comentario explica el porqué en pocas líneas; la historia va al commit o a docs/.`);
		process.exit(1);
	}
	console.log("comentarios: ok");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
