#!/usr/bin/env node
// Comprobaciones estáticas de landing/site/ (sin dependencias).
// Uso: node landing/scripts/check.mjs   → código 1 si algo falla.
// Cubre: peticiones externas, enlaces e ids, metadatos, HTML básico, JS/CSS
// en línea, pesos por recurso y total, JSON-LD y archivos de SEO.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const problems = [];
const fail = (m) => problems.push(m);
const ok = (m) => console.log(`  ok  ${m}`);

function walk(d) {
	return readdirSync(d).flatMap((n) => {
		const p = join(d, n);
		return statSync(p).isDirectory() ? walk(p) : [p];
	});
}
const files = walk(site);
const rel = (p) => relative(site, p);
const text = (p) => readFileSync(join(site, p), "utf8");

// 1. Pesos (presupuesto: JS inicial < 30 KB; todo el sitio ligero).
const BUDGET = { js: 30 * 1024, css: 40 * 1024, html: 60 * 1024, img: 120 * 1024, font: 60 * 1024 };
let total = 0;
let initial = 0; // lo que carga la primera visita: HTML + CSS + JS + 2 fuentes + favicon
console.log("Pesos");
for (const f of files) {
	const size = statSync(f).size;
	total += size;
	const ext = f.split(".").pop();
	const kind = { js: "js", css: "css", html: "html", jpg: "img", png: "img", woff2: "font" }[ext];
	if (kind && size > BUDGET[kind]) fail(`${rel(f)} pesa ${size} B (máx. ${BUDGET[kind]} B)`);
	if (["index.html", "assets/css/styles.css", "assets/js/main.js", "assets/js/theme-init.js", "assets/fonts/inter-latin-wght-normal.woff2", "assets/fonts/bricolage-grotesque-latin-wght-normal.woff2"].includes(rel(f))) initial += size;
	console.log(`  ${String(size).padStart(7)} B  ${rel(f)}`);
}
const js = files.filter((f) => f.endsWith(".js")).reduce((a, f) => a + statSync(f).size, 0);
if (js > BUDGET.js) fail(`JavaScript total ${js} B supera ${BUDGET.js} B`);
console.log(`  total ${total} B · carga inicial ~${initial} B (sin comprimir) · JS ${js} B`);

// 2. Cero peticiones externas: ningún http(s):// cargable (src/href/url()/@import).
const html = text("index.html");
const css = text("assets/css/styles.css");
const loaders = [
	...[...html.matchAll(/<(?:script|img|link|source|iframe)\b[^>]*?(?:src|href)="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]),
	...[...css.matchAll(/url\(\s*["']?(https?:)?\/\//g)].map((m) => m[0]),
	...[...css.matchAll(/@import/g)].map((m) => m[0]),
].filter((s) => !/rel="(canonical|alternate)"/.test(s));
loaders.length ? loaders.forEach((l) => fail(`posible petición externa: ${l}`)) : ok("sin recursos externos (src/href/url()/@import)");

// 3. Sin JS ni CSS en línea (la CSP no lo permite).
const inlineScripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>/g)];
inlineScripts.length ? fail("script en línea") : ok("sin scripts en línea (solo JSON-LD como dato)");
/ style=/.test(html) || /<style/.test(html) ? fail("estilos en línea") : ok("sin estilos en línea");
/ on[a-z]+=/.test(html) ? fail("manejadores on* en línea") : ok("sin manejadores on*");

// 4. Enlaces internos, anclas e ids.
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const dupIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
dupIds.length ? fail(`ids duplicados: ${[...new Set(dupIds)]}`) : ok("ids únicos");
for (const m of html.matchAll(/(?:href|src)="([^"#][^"]*|#[^"]*)"/g)) {
	const u = m[1];
	if (u.startsWith("#")) {
		if (!ids.has(u.slice(1))) fail(`ancla rota: ${u}`);
	} else if (u.startsWith("/") && !u.startsWith("//")) {
		if (!existsSync(join(site, u.split("#")[0])) && u !== "/") fail(`enlace interno roto: ${u}`);
	}
}
for (const m of html.matchAll(/<use href="#([^"]+)"/g)) if (!ids.has(m[1])) fail(`símbolo SVG inexistente: #${m[1]}`);
for (const m of css.matchAll(/url\("([^")]+)"\)/g)) {
	if (!existsSync(join(site, "assets/css", m[1]))) fail(`url() roto en CSS: ${m[1]}`);
}
ok("enlaces internos, anclas y símbolos revisados");

// 5. Metadatos y accesibilidad básica.
const need = [
	[/<html lang="[a-z]{2}"/, "html lang"], [/<title>[^<]{10,}<\/title>/, "title"], [/<meta name="description" content="[^"]{50,}"/, "description"],
	[/<link rel="canonical" href="https?:\/\//, "canonical"], [/<meta property="og:image" content="https?:\/\//, "og:image absoluta"],
	[/<meta name="twitter:card"/, "twitter:card"], [/<meta name="viewport"/, "viewport"], [/hreflang=/, "hreflang"],
	[/<main id="main"/, "landmark main"], [/<header/, "landmark header"], [/<footer/, "landmark footer"], [/<nav [^>]*aria-label=/, "nav con nombre"],
	[/class="skip" href="#main"/, "enlace de salto"], [/application\/ld\+json/, "JSON-LD"],
];
for (const [re, name] of need) re.test(html) ? ok(name) : fail(`falta ${name}`);
(html.match(/<h1\b/g) ?? []).length === 1 ? ok("un único h1") : fail("debe haber exactamente un h1");
for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0]) || !/\bwidth=/.test(m[0]) || !/\bheight=/.test(m[0])) fail(`img sin alt/width/height: ${m[0]}`);
const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => +m[1]);
levels.forEach((l, i) => { if (i && l > levels[i - 1] + 1) fail(`salto de encabezados h${levels[i - 1]} → h${l}`); });
ok("jerarquía de encabezados revisada");
try { JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]); ok("JSON-LD válido"); } catch { fail("JSON-LD inválido"); }
if (/aggregateRating|reviewCount|ratingValue/.test(html)) fail("JSON-LD con valoraciones: prohibido por honestidad");

// 6. Archivos de SEO y despliegue.
for (const f of ["robots.txt", "sitemap.xml", "_headers", "404.html", "favicon.svg", "apple-touch-icon.png", "assets/img/og.jpg"]) existsSync(join(site, f)) ? ok(f) : fail(`falta ${f}`);
/'unsafe-inline'/.test(text("_headers").split("\n").find((l) => l.includes("Content-Security-Policy")) ?? "") ? fail("la CSP contiene 'unsafe-inline'") : ok("CSP sin 'unsafe-inline'");

// 6b. Vercel y Cloudflare deben servir las mismas cabeceras.
if (existsSync(join(site, "..", "vercel.json"))) {
	const vj = JSON.parse(readFileSync(join(site, "..", "vercel.json"), "utf8"));
	const csp = (vj.headers.find((h) => h.source === "/(.*)")?.headers ?? []).find((h) => h.key === "Content-Security-Policy")?.value;
	const cf = text("_headers").split("\n").find((l) => l.includes("Content-Security-Policy"))?.split(/:(.*)/s)[1]?.trim();
	csp && csp === cf ? ok("vercel.json y _headers: misma CSP") : fail("vercel.json y _headers difieren en la CSP");
}

// 7. Honestidad: frases que no deben aparecer.
for (const bad of [/\b\d+\s*(k|mil|\+)?\s*(usuarios|estrellas|descargas|users|stars|downloads)/i, /testimon/i, /funciona en todas|works on (all|every)/i, /GNOME 4[5-9]/, /\bFrset\b|PC Manager|Flameshot|ShareX/i]) {
	bad.test(html) && fail(`texto prohibido por el brief: ${bad}`);
}
ok("sin cifras inventadas, testimonios ni marcas ajenas");

// 8. Ranuras de capturas reales: pendientes = aviso; con --release, error.
const pend = (html.match(/class="slot-box"/g) ?? []).length;
if (pend) {
	const msg = `${pend} captura(s) real(es) pendiente(s): el marcador «SCREENSHOT PENDING» no puede publicarse`;
	process.argv.includes("--release") ? fail(msg) : console.log(`  AVISO  ${msg} (check.mjs --release lo rechaza)`);
} else ok("ranuras de capturas completas");
const slotsFile = join(site, "..", "src", "slots.json");
const simulated = existsSync(slotsFile) ? Object.entries(JSON.parse(readFileSync(slotsFile, "utf8"))).filter(([, v]) => v.simulated).map(([k]) => k) : [];
if (simulated.length) console.log(`  AVISO  imágenes SIMULADAS (renders, no capturas reales): ${simulated.join(", ")}. Sustituir por capturas reales antes del lanzamiento público (no bloquea).`);
if (/lang="en"/.test(html) && /Ilustración|Pronto\b|Instalar\b/.test(html)) fail("quedan textos en español en la página en inglés");

console.log(problems.length ? `\n${problems.length} problema(s):\n- ${problems.join("\n- ")}` : "\nTodo correcto.");
process.exit(problems.length ? 1 : 0);
