import { clearTextLayoutCache, setTextMeasurer } from "./textLayout";

/** Fuente del texto de las anotaciones: la usan el pintado, el PNG y el medidor, para que midan lo que se pinta. */
export function textFont(fontSize: number): string {
	return `600 ${fontSize}px Inter, system-ui, sans-serif`;
}

let canvas: HTMLCanvasElement | undefined;
let lastCtx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
const MAX_CACHED_WIDTHS = 5000;

/**
 * Ancho real de `text` con `measureText` de un canvas 2D propio (nunca el
 * visible, ni `getBoundingClientRect`: no fuerza layout). Memoizado por
 * (tamaño, texto). `null` si no hay canvas 2D o no devuelve un número (jsdom).
 */
export function measureCanvasText(
	text: string,
	fontSize: number,
): number | null {
	try {
		canvas ??= document.createElement("canvas");
		// El contexto de un canvas es siempre el mismo objeto; si cambia (otro
		// canvas, otro motor), las medidas guardadas ya no valen.
		const ctx = canvas.getContext("2d");
		if (ctx !== lastCtx) {
			widths.clear();
			clearTextLayoutCache();
			lastCtx = ctx;
		}
		if (!ctx) return null;
		const key = `${fontSize}\u0000${text}`;
		const hit = widths.get(key);
		if (hit !== undefined) return hit;
		ctx.font = textFont(fontSize);
		const width = ctx.measureText(text).width;
		if (typeof width !== "number" || !Number.isFinite(width)) return null;
		if (widths.size >= MAX_CACHED_WIDTHS) widths.clear();
		widths.set(key, width);
		return width;
	} catch {
		return null;
	}
}

/**
 * Hace que el reparto del texto use medidas reales. Si la fuente termina de
 * cargarse después, las medidas guardadas ya no valen y se descartan.
 */
export function installCanvasTextMetrics(): void {
	setTextMeasurer(measureCanvasText);
	if (typeof document !== "undefined") {
		document.fonts?.addEventListener?.("loadingdone", () => {
			widths.clear();
			clearTextLayoutCache();
		});
	}
}

/** Olvida el canvas y las medidas guardadas (los tests montan un contexto distinto en cada caso). */
export function resetTextMetrics(): void {
	canvas = undefined;
	lastCtx = undefined;
	widths.clear();
}
