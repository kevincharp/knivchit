#!/usr/bin/env node
// Servidor local de landing/site/ que aplica las cabeceras de `_headers`
// (mismo formato que Cloudflare Pages) y sirve 404.html. Solo para verificar.
// Uso: node landing/scripts/serve.mjs [puerto]   (por defecto 8765)

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.argv[2] ?? 8765);
const types = {
	".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
	".webp": "image/webp", ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm", ".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};

// Reglas de _headers: bloque por patrón; los posteriores sobrescriben a los anteriores.
const rules = [];
for (const line of readFileSync(join(site, "_headers"), "utf8").split("\n")) {
	if (!line.trim() || line.startsWith("#")) continue;
	if (!line.startsWith(" ")) rules.push({ pattern: line.trim(), headers: {} });
	else {
		const i = line.indexOf(":");
		rules.at(-1).headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	}
}
const redirects = existsSync(join(site, "_redirects"))
	? readFileSync(join(site, "_redirects"), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim().split(/\s+/))
	: [];
const matches = (pattern, path) =>
	pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;

createServer((req, res) => {
	let path;
	try { path = decodeURIComponent(new URL(req.url, "http://x").pathname); }
	catch { res.writeHead(400); return res.end("URI mal formada"); }
	// _redirects de Cloudflare Pages: «origen destino código» (solo rutas exactas, lo que usa el sitio).
	const redir = redirects.find(([origen]) => origen === path);
	if (redir) { res.writeHead(Number(redir[2] ?? 302), { Location: redir[1] }); return res.end(); }
	let file = normalize(join(site, path.endsWith("/") ? `${path}index.html` : path));
	let status = 200;
	const fuera = relative(site, file);
	if (fuera.startsWith("..") || isAbsolute(fuera) || !existsSync(file) || !statSync(file).isFile()) {
		file = join(site, "404.html");
		status = 404;
	}
	const headers = { "Content-Type": types[extname(file)] ?? "application/octet-stream" };
	for (const r of rules) if (matches(r.pattern, path)) Object.assign(headers, r.headers);
	res.writeHead(status, headers);
	res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => console.log(`http://localhost:${port}/ (cabeceras de _headers aplicadas)`));
