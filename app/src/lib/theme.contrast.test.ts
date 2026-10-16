// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import { readFileSync } from "node:fs";
// @ts-expect-error sin @types/node (mismo caso que vite.config.ts)
import process from "node:process";
import { describe, expect, it } from "vitest";

// El plugin de Tailwind transforma el CSS, así que ?raw no sirve: se lee del disco.
const css: string = readFileSync(
	`${process.cwd()}/src/styles/theme.css`,
	"utf8",
);

type Rgba = [number, number, number, number];

function tokens(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of block.matchAll(/(--[\w-]+):\s*([^;]+);/g))
		out[m[1]] = m[2].trim();
	return out;
}

const dark = tokens(/@theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "");
const light = {
	...dark,
	...tokens(
		/:root\[data-theme="light"\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "",
	),
};

function parse(v: string): Rgba {
	const hex = /^#([0-9a-f]{6})$/i.exec(v);
	if (hex) {
		const n = Number.parseInt(hex[1], 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
	}
	const m = /rgba?\(([^)]+)\)/.exec(v);
	if (!m) throw new Error(`color no reconocido: ${v}`);
	const p = m[1].split(",").map((x) => Number.parseFloat(x));
	return [p[0], p[1], p[2], p[3] ?? 1];
}

function over(fg: Rgba, bg: Rgba): Rgba {
	const a = fg[3];
	return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1) as Rgba;
}

function lum([r, g, b]: Rgba) {
	const f = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a: Rgba, b: Rgba) {
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** Contraste de `fg` sobre `bg`; los colores con alfa se componen sobre `base`. */
function contrast(
	t: Record<string, string>,
	fg: string,
	bg: string,
	base = "--color-bg",
) {
	const root = parse(t[base]);
	const back = over(parse(t[bg]), root);
	const front = over(parse(t[fg]), back);
	return ratio(front, back);
}

const AA = 4.5;

describe.each([
	["oscuro", dark],
	["claro", light],
])("contraste AA en tema %s", (_name, t) => {
	const pairs: [string, string, string][] = [
		["texto / fondo", "--color-fg", "--color-bg"],
		["texto / tarjeta", "--color-fg", "--color-card"],
		["texto / barra", "--color-fg", "--color-bg-alt"],
		["atenuado / fondo", "--color-fg-muted", "--color-bg"],
		["atenuado / tarjeta", "--color-fg-muted", "--color-card"],
		["atenuado / barra", "--color-fg-muted", "--color-bg-alt"],
		["acento (texto) / fondo", "--color-accent-ink", "--color-bg"],
		["acento (texto) / tarjeta", "--color-accent-ink", "--color-card"],
		["ok / tarjeta", "--color-ok", "--color-card"],
		["aviso / tarjeta", "--color-accent-warm", "--color-card"],
		["insignia Pronto / insignia", "--color-badge-ink", "--color-badge"],
		["blanco / relleno de acento", "--color-on-accent", "--color-accent-fill"],
	];
	it.each(pairs)("%s ≥ 4,5:1", (_label, fg, bg) => {
		expect(contrast(t, fg, bg)).toBeGreaterThanOrEqual(AA);
	});
});

describe("el azul de marca no se usa como relleno con texto", () => {
	it("blanco sobre #4c82ff no alcanza AA (de ahí --color-accent-fill)", () => {
		expect(ratio(parse("#ffffff"), parse("#4c82ff"))).toBeLessThan(AA);
	});
});
