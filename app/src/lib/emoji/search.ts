import type { Emoji } from "./types";

export function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

// 0 = nombre exacto, 1 = prefijo del nombre, 2 = palabra clave exacta, 3 = contiene; -1 = no coincide.
function rank(emoji: Emoji, query: string, tokens: string[]): number {
	const name = normalize(emoji.name);
	const keywords = emoji.keywords.map(normalize);
	if (name === query) return 0;
	if (name.startsWith(query)) return 1;
	if (keywords.includes(query)) return 2;
	const haystack = [name, ...keywords];
	return tokens.every((token) => haystack.some((text) => text.includes(token)))
		? 3
		: -1;
}

export function searchEmojis(
	data: readonly Emoji[],
	query: string,
	limit = 80,
): Emoji[] {
	const normalized = normalize(query);
	if (!normalized) return [];
	const tokens = normalized.split(" ");
	return data
		.map((emoji, position) => ({
			emoji,
			position,
			rank: rank(emoji, normalized, tokens),
		}))
		.filter((hit) => hit.rank >= 0)
		.sort((a, b) => a.rank - b.rank || a.position - b.position)
		.slice(0, limit)
		.map((hit) => hit.emoji);
}
