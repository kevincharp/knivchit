/**
 * Modelo puro de anotaciones (sin DOM). Todas las coordenadas están en píxeles
 * de la imagen capturada (absolutas, no relativas a la selección, para que no
 * se muevan al redimensionarla). El historial guarda instantáneas inmutables,
 * de modo que añadir, borrar y deshacer comparten un solo mecanismo.
 */
import { mosaicBrushDiameter } from "./mosaic";
import { ESTIMATED_CHAR_WIDTH, textWidth, wrapText } from "./textLayout";

export type AnnotationKind =
	| "rect"
	| "ellipse"
	| "arrow"
	| "pen"
	| "text"
	| "mosaic";

// `mosaic` es un pincel como `pen`: `points` es el recorrido y `stroke_width`
// fija el diámetro del pincel (ver mosaic.ts).

/** Alineación horizontal del texto dentro de su recuadro. */
export type TextAlign = "left" | "center" | "right";

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface Annotation {
	id: string;
	kind: AnnotationKind;
	color: string;
	stroke_width: number;
	/** Primer punto: esquina del rect/elipse, origen de la flecha, esquina superior izquierda del texto. */
	start: Point;
	/** Segundo punto: esquina opuesta o punta de la flecha. En `pen`, `mosaic` y `text` coincide con `start` al empezar. */
	end: Point;
	/** Solo `pen` y `mosaic`: trazo completo, incluido el primer punto. */
	points?: Point[];
	/** Solo `text`: contenido, admite saltos de línea. */
	text?: string;
	/** Solo `text`: tamaño de fuente (px de imagen). Sin él se deriva del grosor (`textFontSize`). */
	font_size?: number;
	/** Solo `text`: alineación de las líneas dentro del recuadro; sin ella, a la izquierda. */
	text_align?: TextAlign;
	/**
	 * Solo `text`: ancho FIJO del recuadro (px de imagen); el texto se reparte en
	 * líneas dentro de él. Sin él el ancho es AUTOMÁTICO: el de la línea más ancha,
	 * que crece al escribir hasta `max_right`. Las manijas e/w lo fijan.
	 */
	box_width?: number;
	/** Solo `text` con ancho automático: borde derecho (px de imagen) hasta el que puede crecer; pasado él, el texto baja de línea. */
	max_right?: number;
}

export interface AnnotationHistory {
	/** Estados anteriores, del más antiguo al más reciente. */
	past: Annotation[][];
	/** Anotaciones visibles, de la más antigua (abajo) a la más reciente (arriba). */
	present: Annotation[];
	/** Estados deshechos; el último es el próximo que rehace. */
	future: Annotation[][];
}

/** Tolerancia por defecto (px de imagen) para el borrador. */
export const DEFAULT_ERASE_TOLERANCE = 6;

const TEXT_SIZE_PER_STROKE = 6;
const TEXT_LINE_HEIGHT = 1.2;
const TEXT_CHAR_WIDTH = ESTIMATED_CHAR_WIDTH;

export function createHistory(): AnnotationHistory {
	return { past: [], present: [], future: [] };
}

function commit(
	history: AnnotationHistory,
	present: Annotation[],
): AnnotationHistory {
	return { past: [...history.past, history.present], present, future: [] };
}

/** Añade encima de las demás y descarta lo que se podía rehacer. */
export function addAnnotation(
	history: AnnotationHistory,
	annotation: Annotation,
): AnnotationHistory {
	return commit(history, [...history.present, annotation]);
}

/** Vuelve al estado anterior. Sin historial, devuelve la misma referencia. */
export function undo(history: AnnotationHistory): AnnotationHistory {
	if (history.past.length === 0) return history;
	return {
		past: history.past.slice(0, -1),
		present: history.past[history.past.length - 1],
		future: [...history.future, history.present],
	};
}

/** Reaplica el último estado deshecho. Sin nada que rehacer, devuelve la misma referencia. */
export function redo(history: AnnotationHistory): AnnotationHistory {
	if (history.future.length === 0) return history;
	return {
		past: [...history.past, history.present],
		present: history.future[history.future.length - 1],
		future: history.future.slice(0, -1),
	};
}

export function canUndo(history: AnnotationHistory): boolean {
	return history.past.length > 0;
}

export function canRedo(history: AnnotationHistory): boolean {
	return history.future.length > 0;
}

/** Tamaño de fuente (px de imagen) del texto según el grosor elegido. */
export function textFontSize(strokeWidth: number): number {
	return strokeWidth * TEXT_SIZE_PER_STROKE;
}

/** Límites del tamaño de fuente (px de imagen) al escalar el texto con las manijas. */
export const MIN_TEXT_FONT_SIZE = 10;
export const MAX_TEXT_FONT_SIZE = 400;

/** Ancho mínimo del recuadro de texto, en caracteres: menos no se lee ni se agarra. */
const MIN_TEXT_BOX_CHARS = 2;

/**
 * Margen (px de imagen) entre un texto y el borde derecho del área de captura: el
 * recuadro no llega pegado al borde. Se aplica al ancho automático, al ancho por
 * defecto, al anclaje cerca del borde y a los límites del arrastre. Si el área es
 * tan estrecha que con el margen no cabe el ancho mínimo, el margen se reduce
 * (hasta 0) para que el mínimo siga cabiendo.
 */
export const TEXT_RIGHT_MARGIN = 12;

/** Ancho mínimo de un texto nuevo, en caracteres: menos no se lee ni se agarra. */
const MIN_NEW_TEXT_CHARS = 8;

/**
 * Recuadro de un texto NUEVO insertado en `at`: llega hasta el borde derecho del
 * área menos TEXT_RIGHT_MARGIN (el texto se parte en líneas al llegar ahí y nunca
 * se sale), con un mínimo; si a la derecha de `at` queda menos que el mínimo, el
 * recuadro se ancla a ese borde con el mínimo (o con todo el ancho del área si es
 * menor). `right` es el tope derecho resultante, para guardarlo en `max_right`.
 */
export function newTextBox(
	at: Point,
	fontSize: number,
	area: { x: number; w: number },
): { x: number; width: number; right: number } {
	const minWidth = Math.min(
		area.w,
		fontSize * TEXT_CHAR_WIDTH * MIN_NEW_TEXT_CHARS,
	);
	const margin = Math.min(TEXT_RIGHT_MARGIN, Math.max(0, area.w - minWidth));
	const right = area.x + area.w - margin;
	const available = right - at.x;
	if (available >= minWidth) return { x: at.x, width: available, right };
	return {
		x: Math.max(area.x, right - minWidth),
		width: minWidth,
		right,
	};
}

/** Tamaño de fuente efectivo (px de imagen) de una anotación de texto. */
export function annotationFontSize(annotation: Annotation): number {
	return annotation.font_size ?? textFontSize(annotation.stroke_width);
}

/**
 * Líneas del texto tal como se pintan, en pantalla y en el PNG final: los
 * saltos propios y, si hay `box_width`, el reparto por palabras con el ancho
 * REAL de cada una (ver textLayout.ts). Una sola función para recuadro, pintado,
 * campo de edición y composición: coinciden siempre.
 */
export function layoutText(annotation: Annotation): string[] {
	return wrapText(
		annotation.text ?? "",
		annotationFontSize(annotation),
		textWrapWidth(annotation),
	);
}

/** Ancho mínimo (caracteres) de un recuadro automático: un cursor cómodo de agarrar. */
const MIN_AUTO_TEXT_CHARS = 2;

/**
 * Ancho al que se parte el texto: el fijo si lo hay; si no, lo que queda hasta
 * `max_right` (nunca menos de un mínimo); sin ninguno de los dos, no se parte.
 */
export function textWrapWidth(annotation: Annotation): number | undefined {
	if (annotation.box_width) return annotation.box_width;
	if (annotation.max_right === undefined) return undefined;
	const size = annotationFontSize(annotation);
	return Math.max(
		annotation.max_right - annotation.start.x,
		size * TEXT_CHAR_WIDTH * MIN_AUTO_TEXT_CHARS,
	);
}

function boxFromPoints(points: Point[]): Box {
	const xs = points.map((p) => p.x);
	const ys = points.map((p) => p.y);
	const x = Math.min(...xs);
	const y = Math.min(...ys);
	return {
		x,
		y,
		width: Math.max(...xs) - x,
		height: Math.max(...ys) - y,
	};
}

/**
 * Caja contenedora de la geometría, sin el ancho del trazo (el mosaico sí
 * incluye medio pincel por cada lado: lo que se pixela es todo el pincel). El
 * texto se estima (sin DOM no hay métricas reales): sirve para el borrador, no
 * para pintar.
 */
export function annotationBox(annotation: Annotation): Box {
	switch (annotation.kind) {
		case "pen":
			return boxFromPoints(
				annotation.points?.length
					? annotation.points
					: [annotation.start, annotation.end],
			);
		case "mosaic": {
			const r = mosaicBrushDiameter(annotation.stroke_width) / 2;
			const b = boxFromPoints(
				annotation.points?.length
					? annotation.points
					: [annotation.start, annotation.end],
			);
			return {
				x: b.x - r,
				y: b.y - r,
				width: b.width + 2 * r,
				height: b.height + 2 * r,
			};
		}
		case "text": {
			const size = annotationFontSize(annotation);
			const lines = layoutText(annotation);
			const widest = Math.max(...lines.map((l) => textWidth(l, size)));
			// Ancho automático: el de la línea más ancha mientras cabe en una línea por
			// párrafo; en cuanto el tope obliga a bajar de línea, el recuadro ocupa todo
			// el tope (si no, se encogería cada vez que una palabra baja).
			const limit = textWrapWidth(annotation);
			const wrapped =
				limit !== undefined &&
				lines.length > (annotation.text ?? "").split("\n").length;
			return {
				x: annotation.start.x,
				y: annotation.start.y,
				width:
					annotation.box_width ??
					(wrapped
						? limit
						: Math.max(widest, size * TEXT_CHAR_WIDTH * MIN_AUTO_TEXT_CHARS)),
				height: lines.length * size * TEXT_LINE_HEIGHT,
			};
		}
		default:
			return boxFromPoints([annotation.start, annotation.end]);
	}
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const lengthSq = dx * dx + dy * dy;
	const t =
		lengthSq === 0
			? 0
			: Math.max(
					0,
					Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq),
				);
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insideBox(p: Point, box: Box, margin: number): boolean {
	return (
		p.x >= box.x - margin &&
		p.x <= box.x + box.width + margin &&
		p.y >= box.y - margin &&
		p.y <= box.y + box.height + margin
	);
}

/** ¿El punto toca la anotación? Rect y elipse solo por el contorno; el texto por su área; lápiz y mosaico por su recorrido (el mosaico, con todo el pincel). */
export function hitTest(
	annotation: Annotation,
	point: Point,
	tolerance: number = DEFAULT_ERASE_TOLERANCE,
): boolean {
	const reach = tolerance + annotation.stroke_width / 2;
	const box = annotationBox(annotation);
	switch (annotation.kind) {
		case "text":
			return insideBox(point, box, tolerance);
		case "mosaic": {
			const pts = annotation.points?.length
				? annotation.points
				: [annotation.start, annotation.end];
			const brush =
				tolerance + mosaicBrushDiameter(annotation.stroke_width) / 2;
			if (pts.length === 1) {
				return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= brush;
			}
			return pts.some(
				(p, i) => i > 0 && distanceToSegment(point, pts[i - 1], p) <= brush,
			);
		}
		case "arrow":
			return (
				distanceToSegment(point, annotation.start, annotation.end) <= reach
			);
		case "pen": {
			const pts = annotation.points?.length
				? annotation.points
				: [annotation.start];
			if (pts.length === 1) {
				return Math.hypot(point.x - pts[0].x, point.y - pts[0].y) <= reach;
			}
			return pts.some(
				(p, i) => i > 0 && distanceToSegment(point, pts[i - 1], p) <= reach,
			);
		}
		case "rect": {
			if (!insideBox(point, box, reach)) return false;
			const inner = {
				x: box.x + reach,
				y: box.y + reach,
				width: box.width - 2 * reach,
				height: box.height - 2 * reach,
			};
			return (
				inner.width <= 0 || inner.height <= 0 || !insideBox(point, inner, 0)
			);
		}
		case "ellipse": {
			const rx = box.width / 2;
			const ry = box.height / 2;
			if (rx === 0 || ry === 0) return insideBox(point, box, reach);
			const dx = point.x - (box.x + rx);
			const dy = point.y - (box.y + ry);
			// Distancia al contorno por la normal local: |f| / |∇f| con
			// f = (dx/rx)² + (dy/ry)² − 1. Exacta en el contorno y muy fiel cerca de él.
			const f = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) - 1;
			const gradient = 2 * Math.hypot(dx / (rx * rx), dy / (ry * ry));
			return gradient > 0 && Math.abs(f) / gradient <= reach;
		}
	}
}

/** Id de la anotación superior bajo el punto, o `null`. */
export function findAnnotationAt(
	list: Annotation[],
	point: Point,
	tolerance: number = DEFAULT_ERASE_TOLERANCE,
): string | null {
	for (let i = list.length - 1; i >= 0; i--) {
		if (hitTest(list[i], point, tolerance)) return list[i].id;
	}
	return null;
}

/**
 * Borra la anotación superior bajo el punto. Si no hay ninguna devuelve la
 * misma referencia (no ensucia el historial). El borrado se puede deshacer.
 */
export function removeAnnotationAt(
	history: AnnotationHistory,
	point: Point,
	tolerance: number = DEFAULT_ERASE_TOLERANCE,
): AnnotationHistory {
	const id = findAnnotationAt(history.present, point, tolerance);
	if (id === null) return history;
	return commit(
		history,
		history.present.filter((a) => a.id !== id),
	);
}

/**
 * Asa de edición: extremos de una flecha; en rect y elipse, las 4 esquinas de la
 * caja y los 4 puntos medios de sus lados (n, e, s, w).
 */
export type AnnotationHandleId =
	| "start"
	| "end"
	| "nw"
	| "ne"
	| "sw"
	| "se"
	| "n"
	| "e"
	| "s"
	| "w";

/** Radio (px de imagen) para acertar un asa; el llamador lo ajusta a la escala de pantalla. */
export const DEFAULT_HANDLE_TOLERANCE = 8;

/** Lado mínimo (px de imagen) de rect y elipse al redimensionar: más pequeña no se ve ni se agarra. */
export const MIN_ANNOTATION_SIZE = 8;

const BOX_HANDLES = ["nw", "ne", "sw", "se", "n", "e", "s", "w"] as const;
/** El texto no tiene asas en n/s: su alto lo da el reparto en líneas, no se estira. */
const TEXT_HANDLES: readonly BoxHandleId[] = ["nw", "ne", "sw", "se", "e", "w"];
type BoxHandleId = (typeof BOX_HANDLES)[number];

/** Qué bordes de la caja mueve cada asa: -1 el menor (izquierdo/superior), 1 el mayor, 0 ninguno. */
const HANDLE_SIDES: Record<BoxHandleId, { x: -1 | 0 | 1; y: -1 | 0 | 1 }> = {
	nw: { x: -1, y: -1 },
	ne: { x: 1, y: -1 },
	sw: { x: -1, y: 1 },
	se: { x: 1, y: 1 },
	n: { x: 0, y: -1 },
	e: { x: 1, y: 0 },
	s: { x: 0, y: 1 },
	w: { x: -1, y: 0 },
};

function isBoxHandle(handle: AnnotationHandleId): handle is BoxHandleId {
	return handle in HANDLE_SIDES;
}

/**
 * Fracción del semilado a la que cae el asa diagonal de la elipse sobre su curva
 * (cos 45°): la esquina de su caja queda lejos de la línea, donde nadie la toca.
 */
const ELLIPSE_DIAGONAL = Math.SQRT1_2;

/** Cuánto del semilado se aleja del centro el asa: 1 en rect y en los lados; cos 45° en las diagonales de la elipse. */
function reachFactor(kind: Annotation["kind"], handle: BoxHandleId): number {
	const side = HANDLE_SIDES[handle];
	return kind === "ellipse" && side.x !== 0 && side.y !== 0
		? ELLIPSE_DIAGONAL
		: 1;
}

/**
 * Asas de la anotación; vacío para lápiz y texto (solo se mueven). Rectángulo y
 * elipse tienen las mismas 8, y todas caen SOBRE su línea dibujada.
 */
export function annotationHandles(
	annotation: Annotation,
): { id: AnnotationHandleId; point: Point }[] {
	switch (annotation.kind) {
		case "arrow":
			return [
				{ id: "start", point: annotation.start },
				{ id: "end", point: annotation.end },
			];
		case "rect":
		case "ellipse":
		case "text": {
			const b = annotationBox(annotation);
			const cx = b.x + b.width / 2;
			const cy = b.y + b.height / 2;
			const ids = annotation.kind === "text" ? TEXT_HANDLES : BOX_HANDLES;
			return ids.map((id) => {
				const side = HANDLE_SIDES[id];
				const k = reachFactor(annotation.kind, id);
				return {
					id,
					point: {
						x: cx + side.x * (b.width / 2) * k,
						y: cy + side.y * (b.height / 2) * k,
					},
				};
			});
		}
		default:
			return [];
	}
}

function isBoxKind(annotation: Annotation): boolean {
	return (
		annotation.kind === "rect" ||
		annotation.kind === "ellipse" ||
		annotation.kind === "text"
	);
}

/** Lado más corto (px de imagen) por debajo del cual rect y elipse no tienen asas: solo se mueven. */
const MIN_SIDE_FOR_HANDLES = 3;

/** Fracción del lado más corto que puede ocupar el radio de una asa: con 8 asas por figura, si es mayor las zonas se solapan y no queda trazo que agarrar entre ellas. */
const HANDLE_REACH_SIDE_FRACTION = 1 / 6;

/**
 * Asa bajo el punto, o `null`. En rect y elipse la zona de cada asa se encoge con
 * la figura (a lo sumo 1/6 de su lado más corto) para que entre asas siempre
 * quede trazo alcanzable, y una figura de menos de 3 px por lado no tiene asas.
 */
export function findHandleAt(
	annotation: Annotation,
	point: Point,
	tolerance: number = DEFAULT_HANDLE_TOLERANCE,
): AnnotationHandleId | null {
	let reach = tolerance;
	if (isBoxKind(annotation)) {
		const b = annotationBox(annotation);
		// El texto es de una o pocas líneas: su alto no limita las zonas (el cuerpo es
		// toda su caja, siempre queda interior que agarrar); solo su ancho.
		const side =
			annotation.kind === "text" ? b.width : Math.min(b.width, b.height);
		if (Math.min(b.width, b.height) < MIN_SIDE_FOR_HANDLES) return null;
		reach = Math.min(tolerance, side * HANDLE_REACH_SIDE_FRACTION);
	}
	// La más cercana dentro del alcance: con zonas que se tocan (un texto de una
	// línea) gana la asa a la que apunta el puntero, no la primera de la lista.
	let best: AnnotationHandleId | null = null;
	let bestDistance = reach;
	for (const h of annotationHandles(annotation)) {
		const d = Math.hypot(point.x - h.point.x, point.y - h.point.y);
		if (d <= bestDistance) {
			best = h.id;
			bestDistance = d;
		}
	}
	return best;
}

function shift(p: Point, dx: number, dy: number): Point {
	return { x: p.x + dx, y: p.y + dy };
}

/** Copia desplazada; la geometría relativa no cambia. */
export function moveAnnotation(
	annotation: Annotation,
	dx: number,
	dy: number,
): Annotation {
	if (dx === 0 && dy === 0) return annotation;
	return {
		...annotation,
		start: shift(annotation.start, dx, dy),
		end: shift(annotation.end, dx, dy),
		...(annotation.points
			? { points: annotation.points.map((p) => shift(p, dx, dy)) }
			: {}),
	};
}

/**
 * Coordenada del borde móvil para que el asa quede en `target` con el borde
 * opuesto `fixed` quieto, respetando el lado mínimo. El asa está a `reach`
 * semilados del centro (1 en rect; cos 45° en las diagonales de la elipse):
 * asa = fixed + (borde − fixed)·(1 + reach)/2. Cruzar el borde opuesto invierte la figura.
 */
function movingEdge(fixed: number, target: number, reach: number): number {
	const edge = fixed + ((target - fixed) * 2) / (1 + reach);
	const size = Math.max(MIN_ANNOTATION_SIZE, Math.abs(edge - fixed));
	return fixed + (edge < fixed ? -size : size);
}

/**
 * Redimensiona un texto con sus asas. Las esquinas lo ESCALAN en proporción
 * (tamaño de fuente y ancho del recuadro, con la esquina opuesta fija; el factor
 * es la proyección del puntero sobre la diagonal); los lados e/w cambian solo el
 * ancho del recuadro y el texto se reparte de nuevo en líneas.
 */
function resizeText(
	annotation: Annotation,
	handle: BoxHandleId,
	point: Point,
): Annotation {
	const b = annotationBox(annotation);
	const side = HANDLE_SIDES[handle];
	const size = annotationFontSize(annotation);
	if (side.y === 0) {
		const minWidth = size * TEXT_CHAR_WIDTH * MIN_TEXT_BOX_CHARS;
		const fixed = side.x === 1 ? b.x : b.x + b.width;
		let width = Math.max(
			minWidth,
			side.x === 1 ? point.x - fixed : fixed - point.x,
		);
		// El borde derecho no pasa del tope (borde del área menos el margen).
		if (side.x === 1 && annotation.max_right !== undefined) {
			width = Math.min(width, Math.max(minWidth, annotation.max_right - fixed));
		}
		const start = { x: side.x === 1 ? fixed : fixed - width, y: b.y };
		return { ...annotation, box_width: width, start, end: start };
	}
	const opposite = {
		x: side.x === 1 ? b.x : b.x + b.width,
		y: side.y === 1 ? b.y : b.y + b.height,
	};
	const dx = side.x * b.width;
	const dy = side.y * b.height;
	const lengthSq = dx * dx + dy * dy;
	if (lengthSq === 0) return annotation;
	const projected =
		((point.x - opposite.x) * dx + (point.y - opposite.y) * dy) / lengthSq;
	// Tamaño ENTERO: con valores fraccionarios cada evento del arrastre pide al
	// navegador una fuente nueva (sin caché) y el repintado cuesta ~10 veces más
	// (medido en WebKitGTK); con enteros solo hay un tamaño por píxel de cambio.
	let nextSize = Math.min(
		MAX_TEXT_FONT_SIZE,
		Math.max(MIN_TEXT_FONT_SIZE, Math.round(size * projected)),
	);
	// Las esquinas del este no llevan el borde derecho más allá del tope.
	if (side.x === 1 && annotation.max_right !== undefined && b.width > 0) {
		const capped = Math.floor(
			(size * (annotation.max_right - opposite.x)) / b.width,
		);
		nextSize = Math.max(MIN_TEXT_FONT_SIZE, Math.min(nextSize, capped));
	}
	const factor = nextSize / size;
	const start = {
		x: side.x === 1 ? opposite.x : opposite.x - b.width * factor,
		y: side.y === 1 ? opposite.y : opposite.y - b.height * factor,
	};
	const { box_width: boxWidth, ...rest } = annotation;
	return {
		...rest,
		start,
		end: start,
		font_size: nextSize,
		...(boxWidth ? { box_width: boxWidth * factor } : {}),
	};
}

/**
 * Copia con un asa llevada a `point`. Flecha: mueve ese extremo. Rect y elipse:
 * el borde (o los dos, en una esquina) opuesto al asa queda fijo, el asa queda
 * donde se soltó y ningún lado baja de MIN_ANNOTATION_SIZE. Sin asa válida
 * devuelve la misma referencia.
 */
export function resizeAnnotationHandle(
	annotation: Annotation,
	handle: AnnotationHandleId,
	point: Point,
): Annotation {
	const current = annotationHandles(annotation).find((h) => h.id === handle);
	if (!current) return annotation;
	if (current.point.x === point.x && current.point.y === point.y) {
		return annotation;
	}
	if (annotation.kind === "arrow") {
		return handle === "start"
			? { ...annotation, start: point }
			: { ...annotation, end: point };
	}
	if (!isBoxHandle(handle)) return annotation;
	if (annotation.kind === "text") return resizeText(annotation, handle, point);
	const b = annotationBox(annotation);
	const side = HANDLE_SIDES[handle];
	const reach = reachFactor(annotation.kind, handle);
	const axis = (s: -1 | 0 | 1, min: number, size: number, target: number) => {
		if (s === 0) return { from: min, to: min + size };
		const fixed = s === 1 ? min : min + size;
		return { from: fixed, to: movingEdge(fixed, target, reach) };
	};
	const x = axis(side.x, b.x, b.width, point.x);
	const y = axis(side.y, b.y, b.height, point.y);
	return {
		...annotation,
		start: { x: x.from, y: y.from },
		end: { x: x.to, y: y.to },
	};
}

/** Sustituye la anotación con el mismo id como un paso de historial. Id desconocido: misma referencia. */
export function replaceAnnotation(
	history: AnnotationHistory,
	next: Annotation,
): AnnotationHistory {
	if (!history.present.some((a) => a.id === next.id)) return history;
	return commit(
		history,
		history.present.map((a) => (a.id === next.id ? next : a)),
	);
}

/** Cambia color, grosor, texto o tamaño de fuente de una anotación. Sin cambios reales: misma referencia. */
export function updateAnnotation(
	history: AnnotationHistory,
	id: string,
	patch: Partial<
		Pick<
			Annotation,
			| "color"
			| "stroke_width"
			| "text"
			| "font_size"
			| "box_width"
			| "text_align"
		>
	>,
): AnnotationHistory {
	const current = history.present.find((a) => a.id === id);
	if (!current) return history;
	const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
		(k) =>
			patch[k] !== undefined &&
			// Sin text_align la alineación es «izquierda»: elegirla de nuevo no es un cambio.
			patch[k] !== (k === "text_align" ? (current[k] ?? "left") : current[k]),
	);
	return changed
		? replaceAnnotation(history, { ...current, ...patch })
		: history;
}

/** Elimina una anotación por id (se puede deshacer). Id desconocido: misma referencia. */
export function removeAnnotation(
	history: AnnotationHistory,
	id: string,
): AnnotationHistory {
	if (!history.present.some((a) => a.id === id)) return history;
	return commit(
		history,
		history.present.filter((a) => a.id !== id),
	);
}
