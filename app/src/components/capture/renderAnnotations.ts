import {
	type Annotation,
	annotationBox,
	annotationFontSize,
	layoutText,
} from "./annotations";
import {
	MOSAIC_BLOCK,
	mosaicBounds,
	mosaicBrushDiameter,
	mosaicCells,
} from "./mosaic";
import type { Rect } from "./selection";
import { installCanvasTextMetrics, textFont } from "./textMetrics";

installCanvasTextMetrics();

export interface RenderSource {
	image: CanvasImageSource;
	/** Esquina de la selección en la imagen: el canvas representa solo esa región. */
	origin: { x: number; y: number };
}

/** Pinta la anotación en un canvas cuyo (0,0) es `source.origin` de la imagen. */
export function drawAnnotation(
	ctx: CanvasRenderingContext2D,
	annotation: Annotation,
	source: RenderSource,
): void {
	const ox = source.origin.x;
	const oy = source.origin.y;
	ctx.save();
	ctx.translate(-ox, -oy);
	ctx.strokeStyle = annotation.color;
	ctx.fillStyle = annotation.color;
	ctx.lineWidth = annotation.stroke_width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const box = annotationBox(annotation);
	switch (annotation.kind) {
		case "rect":
			ctx.strokeRect(box.x, box.y, box.width, box.height);
			break;
		case "ellipse":
			ctx.beginPath();
			ctx.ellipse(
				box.x + box.width / 2,
				box.y + box.height / 2,
				box.width / 2,
				box.height / 2,
				0,
				0,
				Math.PI * 2,
			);
			ctx.stroke();
			break;
		case "arrow":
			drawArrow(ctx, annotation);
			break;
		case "pen":
			drawPen(ctx, annotation);
			break;
		case "text":
			drawText(ctx, annotation);
			break;
		case "mosaic":
			drawMosaic(ctx, annotation, source.image);
			break;
	}
	ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Annotation): void {
	const { start, end } = a;
	const angle = Math.atan2(end.y - start.y, end.x - start.x);
	const head = Math.max(12, a.stroke_width * 4);
	const length = Math.hypot(end.x - start.x, end.y - start.y);
	// El cuerpo se detiene al inicio de la cabeza para no engordar la punta.
	const bodyEnd = Math.max(0, length - head * 0.6);
	ctx.beginPath();
	ctx.moveTo(start.x, start.y);
	ctx.lineTo(
		start.x + Math.cos(angle) * bodyEnd,
		start.y + Math.sin(angle) * bodyEnd,
	);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(end.x, end.y);
	for (const side of [-1, 1]) {
		ctx.lineTo(
			end.x - Math.cos(angle - side * 0.45) * head,
			end.y - Math.sin(angle - side * 0.45) * head,
		);
	}
	ctx.closePath();
	ctx.fill();
}

function drawPen(ctx: CanvasRenderingContext2D, a: Annotation): void {
	const pts = a.points?.length ? a.points : [a.start];
	if (pts.length === 1) {
		ctx.beginPath();
		ctx.arc(pts[0].x, pts[0].y, a.stroke_width / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	for (let i = 1; i < pts.length - 1; i++) {
		const mid = {
			x: (pts[i].x + pts[i + 1].x) / 2,
			y: (pts[i].y + pts[i + 1].y) / 2,
		};
		ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
	}
	const last = pts[pts.length - 1];
	ctx.lineTo(last.x, last.y);
	ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, a: Annotation): void {
	const size = annotationFontSize(a);
	ctx.font = textFont(size);
	ctx.textBaseline = "top";
	// La alineación opera dentro del recuadro: el ancla es el borde izquierdo, el
	// centro o el borde derecho de la caja, y `textAlign` hace el resto.
	const align = a.text_align ?? "left";
	const box = annotationBox(a);
	ctx.textAlign = align;
	const x =
		align === "center"
			? a.start.x + box.width / 2
			: align === "right"
				? a.start.x + box.width
				: a.start.x;
	// Mismo reparto en líneas que el recuadro del modelo: pantalla y PNG coinciden.
	layoutText(a).forEach((line, i) => {
		ctx.fillText(line, x, a.start.y + i * size * 1.2);
	});
}

/**
 * Pincel de mosaico: pixela solo las celdas por donde pasó el trazo. Reduce la
 * región que las envuelve a una celda por píxel y la reescala sin suavizado,
 * recortada por la unión de celdas: lo que queda fuera del trazo no se toca.
 */
function drawMosaic(
	ctx: CanvasRenderingContext2D,
	a: Annotation,
	image: CanvasImageSource,
): void {
	const cells = mosaicCells(
		a.points?.length ? a.points : [a.start, a.end],
		mosaicBrushDiameter(a.stroke_width),
	);
	const b = mosaicBounds(cells);
	if (!b) return;
	const small = document.createElement("canvas");
	small.width = b.cols;
	small.height = b.rows;
	const sctx = small.getContext("2d");
	if (!sctx) return;
	sctx.drawImage(image, b.x, b.y, b.w, b.h, 0, 0, b.cols, b.rows);
	ctx.save();
	ctx.beginPath();
	for (const c of cells) {
		ctx.rect(
			c.cx * MOSAIC_BLOCK,
			c.cy * MOSAIC_BLOCK,
			MOSAIC_BLOCK,
			MOSAIC_BLOCK,
		);
	}
	ctx.clip();
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(small, 0, 0, b.cols, b.rows, b.x, b.y, b.w, b.h);
	ctx.restore();
}

/**
 * Recorta `selection` de la imagen original a resolución nativa y dibuja encima las anotaciones.
 * Solo para la composición final (`composeCapture`) y sobre un canvas fuera del DOM: este
 * `drawImage` del recorte completo en el canvas visible produjo un artefacto de WebKitGTK (fondo
 * negro y una copia desplazada de la pantalla; causa no confirmada). La vista previa usa
 * `renderAnnotationsOnly`.
 */
export function renderSelection(
	canvas: HTMLCanvasElement,
	image: CanvasImageSource,
	selection: Rect,
	annotations: Annotation[],
): void {
	// Reasignar width/height reinicializa el backing store del canvas (costoso
	// en WebKitGTK) aunque el valor no cambie — p. ej. al mover la selección
	// sin cambiar su tamaño. Solo se toca cuando realmente cambia.
	if (canvas.width !== selection.w) canvas.width = selection.w;
	if (canvas.height !== selection.h) canvas.height = selection.h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d no disponible");
	ctx.drawImage(
		image,
		selection.x,
		selection.y,
		selection.w,
		selection.h,
		0,
		0,
		selection.w,
		selection.h,
	);
	const source = { image, origin: { x: selection.x, y: selection.y } };
	for (const annotation of annotations) drawAnnotation(ctx, annotation, source);
}

/**
 * Pinta solo las anotaciones sobre un canvas transparente, para la vista previa en vivo
 * (`AnnotationCanvas`). El recorte de fondo no se dibuja aquí: ya se ve a través del hueco que
 * `SelectionFrame` abre en la máscara (ver `renderSelection` sobre por qué no se repite el
 * `drawImage`). `drawMosaic` sigue necesitando `image` para muestrear el píxel real.
 */
export function renderAnnotationsOnly(
	canvas: HTMLCanvasElement,
	image: CanvasImageSource,
	selection: Rect,
	annotations: Annotation[],
): void {
	if (canvas.width !== selection.w) canvas.width = selection.w;
	if (canvas.height !== selection.h) canvas.height = selection.h;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas 2d no disponible");
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	const source = { image, origin: { x: selection.x, y: selection.y } };
	for (const annotation of annotations) drawAnnotation(ctx, annotation, source);
}

/** PNG final de la selección: tamaño exacto en píxeles de la imagen, en un canvas aparte nunca insertado en el DOM. */
export async function composeCapture(
	image: CanvasImageSource,
	selection: Rect,
	annotations: Annotation[],
): Promise<Uint8Array> {
	const canvas = document.createElement("canvas");
	renderSelection(canvas, image, selection, annotations);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/png"),
	);
	if (!blob) throw new Error("No se pudo generar el PNG");
	return new Uint8Array(await blob.arrayBuffer());
}
