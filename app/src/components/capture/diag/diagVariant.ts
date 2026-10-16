export type DiagVariant = 1 | 2 | 3 | 4 | 5;

/**
 * Lee `diag=N` de la query del overlay. Solo P1–P5 activan una variante de
 * diagnóstico; P0, ausente o inválido devuelven null (overlay real).
 */
export function readDiagVariant(search: string): DiagVariant | null {
	const raw = new URLSearchParams(search).get("diag");
	if (raw === null) return null;
	const n = Number(raw.replace(/^P/i, ""));
	return n >= 1 && n <= 5 && Number.isInteger(n) ? (n as DiagVariant) : null;
}

/** Convierte un data URL base64 en blob URL (sin pasar por el decodificador de data URL del webview). */
export function dataUrlToBlobUrl(dataUrl: string): string {
	const comma = dataUrl.indexOf(",");
	const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
	const bin = atob(dataUrl.slice(comma + 1));
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return URL.createObjectURL(new Blob([bytes], { type: mime }));
}
