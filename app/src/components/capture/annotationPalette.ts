import type { AnnotationKind } from "./annotations";

/** Paleta ofrecida en ToolOptions; cada valor es un token de theme.css. */
export const ANNOTATION_COLORS = [
	{ id: "red", label: "Rojo", token: "--color-ann-red" },
	{ id: "amber", label: "Ámbar", token: "--color-ann-amber" },
	{ id: "blue", label: "Azul", token: "--color-ann-blue" },
	{ id: "green", label: "Verde", token: "--color-ann-green" },
	{ id: "white", label: "Blanco", token: "--color-ann-white" },
	{ id: "black", label: "Negro", token: "--color-ann-black" },
] as const;

export type AnnotationColorId = (typeof ANNOTATION_COLORS)[number]["id"];

/** Grosores (px de imagen) ofrecidos; el texto los multiplica por `textFontSize` y el pincel de mosaico por MOSAIC_BRUSH_PER_STROKE. */
export const STROKE_WIDTHS = [
	{ value: 2, label: "Fino" },
	{ value: 4, label: "Medio" },
	{ value: 8, label: "Grueso" },
	{ value: 16, label: "Muy grueso" },
] as const;

/** Tamaños de fuente (px de imagen) ofrecidos para el texto; el resto de valores salen de escalarlo con las manijas. */
export const TEXT_SIZES = [
	{ value: 12, label: "Texto pequeño" },
	{ value: 24, label: "Texto mediano" },
	{ value: 48, label: "Texto grande" },
	{ value: 96, label: "Texto muy grande" },
] as const;

/** `select` edita anotaciones ya dibujadas; sus opciones son las de la anotación elegida. */
export type Tool = AnnotationKind | "eraser" | "select";

/** Herramientas que usan color (el mosaico y el borrador no). */
export function toolUsesColor(tool: Tool | null): boolean {
	return (
		tool !== null && tool !== "mosaic" && tool !== "eraser" && tool !== "select"
	);
}

/** Herramientas que usan grosor (el borrador no). */
export function toolUsesWidth(tool: Tool | null): boolean {
	return tool !== null && tool !== "eraser" && tool !== "select";
}

/** Lee el valor real del token CSS para pintarlo en un canvas, donde `var()` no aplica. */
export function resolveToken(token: string): string {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(token)
		.trim();
}
