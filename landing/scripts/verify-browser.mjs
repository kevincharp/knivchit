#!/usr/bin/env node
// Verificación en navegador sin interfaz: capturas en 360/768/1280/1920 (oscuro y
// claro), cero peticiones externas, consola limpia (sin violaciones de CSP),
// axe-core (WCAG 2.1 AA) en cada paso de la demostración y recorrido por teclado.
//
// Requiere, fuera del repositorio:  npm i playwright-core axe-core   (en un directorio temporal)
// Uso (con el servidor de `serve.mjs` en marcha y sin tocar tu sesión gráfica):
//   env -u DISPLAY -u WAYLAND_DISPLAY CHROME=/ruta/a/chromium NODE_PATH=/tmp/x/node_modules \
//     node landing/scripts/verify-browser.mjs [url] [directorio-de-salida]

import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const url = process.argv[2] ?? "http://localhost:8765/";
const out = process.argv[3] ?? join(tmpdir(), "knivchit-landing-shots");
mkdirSync(out, { recursive: true });
const origin = new URL(url).origin;
let bad = 0;

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
for (const scheme of ["dark", "light"]) {
	for (const w of [360, 768, 1280, 1920]) {
		const page = await browser.newPage({ viewport: { width: w, height: 900 } });
		// El sitio es oscuro por defecto y no sigue prefers-color-scheme: el tema se fija como lo haría el conmutador.
		await page.addInitScript((t) => localStorage.setItem("knivchit-theme", t), scheme);
		const logs = [];
		const external = [];
		page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
		page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
		page.on("request", (r) => { if (!r.url().startsWith(origin)) external.push(r.url()); });
		await page.goto(url, { waitUntil: "networkidle" });
		await page.screenshot({ path: join(out, `${scheme}-${w}.png`), fullPage: true });
		const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		await page.evaluate(axeSrc);
		const violations = [];
		for (const step of [1, 2, 3]) {
			await page.click(`[data-step="${step}"]`);
			const r = await page.evaluate(async () => (await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] })).violations.map((v) => `${v.id}: ${v.nodes[0].target.join(" ")}`));
			violations.push(...r);
			if (w === 1280) await (await page.$("#stage")).screenshot({ path: join(out, `${scheme}-paso${step}.png`) });
		}
		const problems = [...logs, ...external.map((e) => `externa: ${e}`), ...new Set(violations)];
		if (overflow > 0) problems.push(`desbordamiento horizontal de ${overflow}px`);
		bad += problems.length;
		console.log(`${scheme} ${String(w).padStart(4)}  externas ${external.length}  consola ${logs.length}  axe ${new Set(violations).size}  ${problems.length ? problems.join(" | ") : "ok"}`);
		await page.close();
	}
}

// Teclado: el primer Tab llega al enlace de salto; las flechas cambian de paso.
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.keyboard.press("Tab");
const first = await page.evaluate(() => document.activeElement.className);
await page.focus('[data-step="1"]');
await page.keyboard.press("ArrowDown");
const step = await page.evaluate(() => document.getElementById("stage").dataset.step);
console.log(`teclado: primer foco «${first}» ${first === "skip" ? "ok" : "MAL"} · flecha abajo → paso ${step} ${step === "2" ? "ok" : "MAL"}`);
if (first !== "skip" || step !== "2") bad++;
await browser.close();
console.log(`capturas en ${out}`);
process.exit(bad ? 1 : 0);
