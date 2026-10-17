#!/usr/bin/env node
// Genera landing/site/ a partir de landing/src/ (plantilla + cadenas + config).
// Sin dependencias: solo Node ≥ 20. Uso: node landing/scripts/build.mjs
//
// Plantilla (motor mínimo, ver `render`):
//   {{ruta.a.valor}}            valor de las cadenas (HTML de confianza, sin escapar)
//   {{ruta|attr}}               igual, escapado para usarlo dentro de un atributo
//   {{#each ruta}}…{{/each}}    repite; dentro, {{campo}}, {{@index}}, {{@number}} y {{$.ruta}} (raíz)
//   {{#if ruta}}…{{else}}…{{/if}}
//   {{> parcial}}               incluye landing/src/partials/parcial.html

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const out = join(root, "site");

const config = JSON.parse(readFileSync(join(src, "config.json"), "utf8"));
if (process.env.SITE_URL) config.SITE_URL = process.env.SITE_URL;
config.SITE_URL = config.SITE_URL.replace(/\/+$/, "");

// Las cadenas pueden citar constantes de la configuración ({{VERSION}}, {{REPO_URL}}).
let raw = readFileSync(join(src, "strings", `${config.LOCALE}.json`), "utf8");
for (const k of ["VERSION", "REPO_URL", "RELEASE_URL", "SITE_URL"]) {
	raw = raw.replaceAll(`{{${k}}}`, config[k]);
}
const strings = JSON.parse(raw);
// La FAQ se reparte en dos columnas independientes (orden DOM = orden de lectura, y abrir una pregunta solo empuja su columna).
const half = Math.ceil(strings.faq.list.length / 2);
strings.faq.cols = [{ list: strings.faq.list.slice(0, half) }, { list: strings.faq.list.slice(half) }];

// Ranuras de capturas reales. `src/slots.json` (lo escribe scripts/imagenes.mjs) dice cuáles
// ya tienen imágenes; las que faltan salen como marcador «PENDING» (check.mjs lo avisa y
// `check.mjs --release` lo rechaza). Dimensiones esperadas de cada ranura:
const SLOT_SPEC = {
	overlay: { cls: "8x5", file: "overlay.png", note: "8:5, min 2560×1600", sizes: "(min-width: 1100px) 1100px, 100vw" },
	hub: { cls: "2x3", file: "hub.png", note: "2:3, min 720×1080", sizes: "340px" },
	shortcuts: { cls: "3x2", file: "shortcuts.png", note: "free ratio, min 960 px wide", sizes: "(min-width: 900px) 520px, 100vw" },
};
const manifestFile = join(src, "slots.json");
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : {};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const slotHtml = {};
let pending = 0;
for (const [name, spec] of Object.entries(SLOT_SPEC)) {
	const text = strings.slots[name];
	const m = manifest[name];
	const ready = m && m.widths.every((w) => existsSync(join(out, "assets", "img", `${name}-${w}.webp`)));
	let inner;
	if (ready) {
		const set = (ext) => m.widths.map((w) => `/assets/img/${name}-${w}.${ext} ${w}w`).join(", ");
		const mid = m.widths[Math.floor((m.widths.length - 1) / 2)];
		inner = `<picture>${m.avif ? `<source type="image/avif" srcset="${set("avif")}" sizes="${spec.sizes}">` : ""}<source type="image/webp" srcset="${set("webp")}" sizes="${spec.sizes}"><img src="/assets/img/${name}-${mid}.webp" width="${m.width}" height="${m.height}" alt="${esc(m.simulated ? text.previewAlt : text.alt)}" loading="lazy" decoding="async"></picture>`;
	} else {
		pending++;
		inner = `<div class="slot-box" data-pending="${name}"><strong>SCREENSHOT PENDING</strong><code>${spec.file} · ${spec.note}</code></div>`;
	}
	slotHtml[name] = `<figure class="slot slot-${spec.cls}${ready ? "" : " slot-pending"}" data-slot="${name}">${inner}<figcaption>${ready && m.simulated ? text.previewCaption : text.caption}</figcaption></figure>`;
}
if (pending) console.warn(`  Aviso: ${pending} ranura(s) de captura pendientes (ver landing/README.md)`);

const root_ctx = {
	slotHtml,
	...strings,
	cfg: { ...config },
	has: { repo: Boolean(config.REPO_URL), release: Boolean(config.RELEASE_URL), sponsor: Boolean(config.SPONSOR_URL) },
};

const partials = new Map();
function partial(name) {
	if (!partials.has(name)) {
		partials.set(name, readFileSync(join(src, "partials", `${name}.html`), "utf8"));
	}
	return partials.get(name);
}

const get = (ctx, path) => {
	if (path.startsWith("$.")) return get(ctx.$, path.slice(2));
	return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx);
};

const escAttr = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const TOKEN = /\{\{\s*(#each|#if|\/each|\/if|else|>|)\s*([^}|]*?)\s*(?:\|\s*(attr))?\s*\}\}/g;

function render(tpl, ctx) {
	return renderNodes(parse(tpl), ctx);
}

// Parser recursivo: tokeniza y construye el árbol; `else` reparte los nodos.
function parse(tpl) {
	const tokens = [];
	let last = 0;
	for (const m of tpl.matchAll(TOKEN)) {
		if (m.index > last) tokens.push({ t: "text", v: tpl.slice(last, m.index) });
		tokens.push({ t: m[1] || "var", arg: m[2], filter: m[3] });
		last = m.index + m[0].length;
	}
	if (last < tpl.length) tokens.push({ t: "text", v: tpl.slice(last) });
	let i = 0;
	function block(until) {
		const nodes = [];
		let otherwise = null;
		let cur = nodes;
		while (i < tokens.length) {
			const tk = tokens[i++];
			if (until.includes(tk.t)) return { nodes, otherwise, end: tk.t };
			if (tk.t === "else") {
				otherwise = [];
				cur = otherwise;
			} else if (tk.t === "#each" || tk.t === "#if") {
				const inner = block([tk.t === "#each" ? "/each" : "/if"]);
				cur.push({ type: tk.t.slice(1), arg: tk.arg, children: inner.nodes, otherwise: inner.otherwise });
			} else if (tk.t === "text") cur.push({ type: "text", value: tk.v });
			else if (tk.t === ">") cur.push({ type: "partial", arg: tk.arg });
			else cur.push({ type: "var", arg: tk.arg, filter: tk.filter });
		}
		return { nodes, otherwise, end: null };
	}
	return block([]).nodes;
}

function renderNodes(nodes, ctx) {
	let html = "";
	for (const n of nodes) {
		switch (n.type) {
			case "text":
				html += n.value;
				break;
			case "var": {
				let v;
				if (n.arg === "@index") v = ctx["@index"];
				else if (n.arg === "@number") v = ctx["@number"];
				else v = get(ctx, n.arg);
				if (v === undefined) throw new Error(`Cadena no definida: {{${n.arg}}}`);
				html += n.filter === "attr" ? escAttr(v) : String(v);
				break;
			}
			case "if":
				html += renderNodes(get(ctx, n.arg) ? n.children : (n.otherwise ?? []), ctx);
				break;
			case "each": {
				const list = get(ctx, n.arg) ?? [];
				list.forEach((item, idx) => {
					const child = typeof item === "object" ? { ...item } : { value: item };
					child.$ = ctx.$ ?? ctx;
					child["@index"] = idx;
					child["@number"] = idx + 1;
					child.cfg = child.$.cfg;
					child.has = child.$.has;
					html += renderNodes(n.children, child);
				});
				break;
			}
			case "partial":
				html += renderNodes(parse(partial(n.arg)), ctx);
				break;
		}
	}
	return html;
}

function write(rel, content) {
	content = content.replace(/[ \t]+$/gm, ""); // los bloques {{#if}} dejan espacios al final de línea
	const file = join(out, rel);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
	console.log(`  ${rel} (${Buffer.byteLength(content)} B)`);
}

root_ctx.$ = root_ctx;
const page = (name) => render(readFileSync(join(src, `${name}.template.html`), "utf8"), root_ctx);

console.log("Generando landing/site/");
write("index.html", page("index"));
write("404.html", page("404"));
write(
	"robots.txt",
	`User-agent: *\nAllow: /\n\nSitemap: ${config.SITE_URL}/sitemap.xml\n`,
);
write(
	"sitemap.xml",
	`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${config.SITE_URL}/</loc></url>\n</urlset>\n`,
);
