// Genera app/src/lib/emoji/emoji-data.json a partir de emoji-test.txt y las anotaciones CLDR.
// Uso: node generate-emoji-data.mjs --emoji-test <ruta> --annotations <ruta> --annotations-derived <ruta> --out <ruta>
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const FE0F = "️";
const TONOS = /[\u{1F3FB}-\u{1F3FF}]/gu;
const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

// CLDR indexa sin U+FE0F; las variantes de tono se reducen a su base.
const claveBase = (char) => char.replace(TONOS, "").replaceAll(FE0F, "");
const tieneTono = (char) => char.replace(TONOS, "") !== char;

function decodificar(texto) {
	return texto.replace(/&(\w+);/g, (m, nombre) => ENTIDADES[nombre] ?? m);
}

function leerAnotaciones(ruta) {
	const porChar = new Map();
	const patron =
		/<annotation cp="([^"]+)"( type="tts")?>([^<]*)<\/annotation>/gu;
	for (const [, cp, tts, texto] of readFileSync(ruta, "utf8").matchAll(
		patron,
	)) {
		const entrada = porChar.get(cp) ?? {};
		if (tts) entrada.name = decodificar(texto);
		else entrada.keywords = decodificar(texto).split(" | ");
		porChar.set(cp, entrada);
	}
	return porChar;
}

function leerEmojis(ruta) {
	const lineas = readFileSync(ruta, "utf8").split("\n");
	const base = new Map();
	let grupo = "";
	for (const linea of lineas) {
		const g = linea.match(/^# group: (.+)$/);
		if (g) {
			grupo = g[1];
			continue;
		}
		const m = linea.match(
			/^([0-9A-F ]+?)\s*; fully-qualified\s+# (\S+) E[\d.]+ (.+)$/,
		);
		if (!m) continue;
		const [, , char, nombreEn] = m;
		const clave = claveBase(char);
		if (tieneTono(char)) {
			const existente = base.get(clave);
			if (existente) existente.hasTones = true;
			continue;
		}
		base.set(clave, { char, nombreEn, grupo, hasTones: false });
	}
	return [...base.values()];
}

const { values } = parseArgs({
	options: {
		"emoji-test": { type: "string" },
		annotations: { type: "string" },
		"annotations-derived": { type: "string" },
		out: { type: "string" },
	},
});

const anotaciones = new Map([
	...leerAnotaciones(values["annotations-derived"]),
	...leerAnotaciones(values.annotations),
]);

const datos = leerEmojis(values["emoji-test"]).map(
	({ char, nombreEn, grupo, hasTones }) => {
		const nota = anotaciones.get(claveBase(char));
		return {
			char,
			name: nota?.name ?? nombreEn,
			keywords: nota?.keywords ?? [],
			group: grupo,
			hasTones,
		};
	},
);

writeFileSync(values.out, `${JSON.stringify(datos)}\n`);
