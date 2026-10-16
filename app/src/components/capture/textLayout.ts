/**
 * Reparto del texto en líneas, puro y sin DOM. El ancho de cada trozo lo da un
 * «medidor» que se inyecta (en la app, `measureText` de un canvas 2D con la
 * MISMA fuente que el pintado: ver textMetrics.ts); sin medidor, o si este no
 * devuelve un número, se estima a 0,6 em por carácter. Pantalla, campo de
 * edición y PNG final llaman a esta misma función, así coinciden siempre.
 */

export type TextMeasurer = (
	text: string,
	fontSize: number,
) => number | null | undefined;

/** Ancho estimado por carácter (em) cuando no hay medidor. */
export const ESTIMATED_CHAR_WIDTH = 0.6;

let measurer: TextMeasurer | null = null;
const layouts = new Map<string, string[]>();
const MAX_CACHED_LAYOUTS = 300;

export function clearTextLayoutCache(): void {
	layouts.clear();
}

/** Instala (o quita con `null`) el medidor y descarta los repartos calculados con el anterior. */
export function setTextMeasurer(next: TextMeasurer | null): void {
	measurer = next;
	layouts.clear();
}

/** Ancho (px de imagen) de `text` en una sola línea con la fuente de ese tamaño. */
export function textWidth(text: string, fontSize: number): number {
	const w = measurer?.(text, fontSize);
	return typeof w === "number" && Number.isFinite(w)
		? w
		: text.length * fontSize * ESTIMATED_CHAR_WIDTH;
}

/** Parte `word` (más ancha que `maxWidth`) por caracteres: al menos uno por trozo. */
function splitWord(word: string, fontSize: number, maxWidth: number): string[] {
	const chunks: string[] = [];
	let chunk = "";
	let chunkWidth = 0;
	for (const ch of word) {
		const w = textWidth(ch, fontSize);
		if (chunk && chunkWidth + w > maxWidth) {
			chunks.push(chunk);
			chunk = "";
			chunkWidth = 0;
		}
		chunk += ch;
		chunkWidth += w;
	}
	if (chunk) chunks.push(chunk);
	return chunks;
}

/**
 * Líneas de `text`: sus saltos propios y, con `maxWidth`, el reparto por
 * palabras. Una palabra más ancha que la caja se parte por caracteres; ninguna
 * línea medida (palabra a palabra, más los espacios) pasa de `maxWidth`.
 * Memoizado por (tamaño, ancho, texto): arrastrar un recuadro repite pocas
 * combinaciones y no vuelve a medir.
 */
export function wrapText(
	text: string,
	fontSize: number,
	maxWidth?: number,
): string[] {
	const paragraphs = text.split("\n");
	if (!maxWidth) return paragraphs;
	const key = `${fontSize}|${maxWidth}|${text}`;
	const cached = layouts.get(key);
	if (cached) return cached;
	const space = textWidth(" ", fontSize);
	const lines: string[] = [];
	for (const paragraph of paragraphs) {
		let line = "";
		let lineWidth = 0;
		for (const word of paragraph.split(" ")) {
			const wordWidth = textWidth(word, fontSize);
			if (line !== "" && lineWidth + space + wordWidth <= maxWidth) {
				line += ` ${word}`;
				lineWidth += space + wordWidth;
				continue;
			}
			if (line !== "") lines.push(line);
			if (wordWidth > maxWidth && word.length > 1) {
				const chunks = splitWord(word, fontSize, maxWidth);
				for (const c of chunks.slice(0, -1)) lines.push(c);
				line = chunks[chunks.length - 1];
				lineWidth = textWidth(line, fontSize);
			} else {
				line = word;
				lineWidth = wordWidth;
			}
		}
		lines.push(line);
	}
	if (layouts.size >= MAX_CACHED_LAYOUTS) layouts.clear();
	layouts.set(key, lines);
	return lines;
}
