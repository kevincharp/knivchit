import type { Point } from "./annotations";
import type { Rect } from "./selection";

/** Píxeles de pantalla por píxel de imagen. */
export interface Scale {
	x: number;
	y: number;
}

/**
 * Imagen → coordenadas locales del área de captura (origen en su esquina
 * superior izquierda, en px de pantalla). Es la transformación que usa todo lo
 * que se dibuja DENTRO del contenedor del área (marco y asas de la figura).
 */
export function imageToArea(p: Point, area: Rect, scale: Scale): Point {
	return { x: (p.x - area.x) * scale.x, y: (p.y - area.y) * scale.y };
}

/** Inversa de `imageToArea`. */
export function areaToImage(p: Point, area: Rect, scale: Scale): Point {
	return { x: area.x + p.x / scale.x, y: area.y + p.y / scale.y };
}
