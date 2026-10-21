export function createRecents(max = 16) {
	let chars: string[] = [];
	return {
		list: () => [...chars],
		push(char: string) {
			chars = [char, ...chars.filter((c) => c !== char)].slice(0, max);
		},
	};
}
