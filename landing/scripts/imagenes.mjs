#!/usr/bin/env node
// Convierte las capturas REALES de la app en las imágenes del sitio.
// Uso: node landing/scripts/imagenes.mjs [ranura …]      (sin argumentos: todas las que tengan fuente)
//
// Entrada:  landing/fuentes/<ranura>.png  (PNG sin recortar ni escalar, a resolución nativa; no se versiona)
// Salida:   landing/site/assets/img/<ranura>-<ancho>.webp (y .avif si hay codificador) — estas SÍ se versionan
// Además imprime el <picture> listo para pegar en la plantilla, con srcset, width y height.
// Requiere ImageMagick (`magick`); AVIF solo si hay `avifenc` o un `magick` con soporte AVIF.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const fuentes = join(raiz, "fuentes");
const salida = join(raiz, "site", "assets", "img");

// Ranuras. `ratio` fija la proporción exacta de la fuente (null = libre, la altura sale de la fuente);
// `anchos` son los anchos generados, el último es el mínimo que debe tener la fuente.
// `sizes` es el atributo del <picture>; `plantilla`, dónde sustituye a la maqueta.
const RANURAS = {
	overlay: {
		ratio: [8, 5],
		anchos: [640, 1280, 1920, 2560],
		sizes: "(min-width: 1100px) 640px, 100vw",
		plantilla: "src/index.template.html (ranura overlay, bajo el héroe)",
		alt: "strings/en.json (slots.overlay.alt)",
	},
	hub: {
		ratio: [2, 3],
		anchos: [360, 720],
		sizes: "360px",
		plantilla: "src/index.template.html (ranura hub, sección de ajustes)",
		alt: "strings/en.json (slots.hub.alt)",
	},
	shortcuts: {
		ratio: null,
		anchos: [480, 960],
		sizes: "480px",
		plantilla: "src/index.template.html (sección de ajustes, tarjeta de atajos)",
		alt: "strings/en.json (slots.shortcuts.alt)",
	},
};

const ejecutar = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
if (ejecutar("magick", ["-version"]).status !== 0) {
	console.error("Falta ImageMagick (`magick`). Instálalo y reintenta.");
	process.exit(1);
}
const avifenc = ejecutar("avifenc", ["--version"]).status === 0;
const magickAvif = /\bAVIF\b/.test(ejecutar("magick", ["-list", "format"]).stdout ?? "");
if (!avifenc && !magickAvif) console.warn("Aviso: sin codificador AVIF (avifenc o magick con AVIF); solo se genera WebP.");

const pedidas = process.argv.slice(2);
for (const n of pedidas) if (!RANURAS[n]) { console.error(`Ranura desconocida «${n}». Válidas: ${Object.keys(RANURAS).join(", ")}`); process.exit(1); }

mkdirSync(salida, { recursive: true });
const manifestFile = join(raiz, "src", "slots.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
let hecho = 0;
for (const [nombre, r] of Object.entries(RANURAS)) {
	if (pedidas.length && !pedidas.includes(nombre)) continue;
	const origen = join(fuentes, `${nombre}.png`);
	if (!existsSync(origen)) { console.log(`· ${nombre}: sin fuente (${origen}), se omite`); continue; }

	const [w, h] = ejecutar("magick", ["identify", "-format", "%w %h", `${origen}[0]`]).stdout.trim().split(" ").map(Number);
	const max = r.anchos.at(-1);
	if (!(w >= max)) { console.error(`✗ ${nombre}: la fuente mide ${w}×${h}; necesita al menos ${max} px de ancho.`); process.exit(1); }
	if (r.ratio && Math.abs(w / h - r.ratio[0] / r.ratio[1]) > 0.005) {
		console.error(`✗ ${nombre}: la fuente mide ${w}×${h} (${(w / h).toFixed(3)}); debe ser ${r.ratio[0]}:${r.ratio[1]}. No se recorta sola: vuelve a capturar.`);
		process.exit(1);
	}

	const lineas = [];
	for (const ancho of r.anchos) {
		const alto = Math.round((ancho * h) / w);
		const base = join(salida, `${nombre}-${ancho}`);
		const redim = ["-filter", "Lanczos", "-resize", `${ancho}x${alto}!`, "-strip"];
		const webp = ejecutar("magick", [`${origen}[0]`, ...redim, "-quality", "82", "-define", "webp:method=6", `${base}.webp`]);
		if (webp.status !== 0) { console.error(webp.stderr); process.exit(1); }
		if (avifenc) {
			const png = `${base}.tmp.png`;
			ejecutar("magick", [`${origen}[0]`, ...redim, png]);
			ejecutar("avifenc", ["-q", "55", "-s", "4", png, `${base}.avif`]);
			ejecutar("rm", ["-f", png]);
		} else if (magickAvif) {
			ejecutar("magick", [`${origen}[0]`, ...redim, "-quality", "55", `${base}.avif`]);
		}
		lineas.push({ ancho, alto, kb: Math.round(statSync(`${base}.webp`).size / 1024) });
		console.log(`✓ ${nombre}-${ancho}.webp  ${ancho}×${alto}  ${lineas.at(-1).kb} KB`);
	}

	const ult = lineas.at(-1);
	// Si existe landing/fuentes/SIMULADAS, las imágenes son renders de la interfaz, no capturas reales:
	// el sitio las llama «Interface preview» y check.mjs avisa de sustituirlas antes del lanzamiento público.
	manifest[nombre] = { widths: r.anchos, width: ult.ancho, height: ult.alto, avif: Boolean(avifenc || magickAvif), simulated: existsSync(join(fuentes, "SIMULADAS")) };
	console.log(`\n${nombre}: listo para ${r.plantilla}; el alt y el pie están en ${r.alt}\n`);
	hecho++;
}
if (hecho) { writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`); console.log("src/slots.json actualizado: ahora `node landing/scripts/build.mjs` publica las imágenes."); }
if (!hecho) console.log("Nada que convertir: deja las capturas en landing/fuentes/<ranura>.png (overlay, hub, shortcuts; ver landing/README.md).");
