import {
	type Annotation,
	annotationBox,
	annotationHandles,
} from "./annotations";
import type { Rect } from "./selection";
import { imageToArea } from "./viewTransform";

/** Radio (px de pantalla) de la zona sensible de una manija o de un cuerpo: 28 px de lado. */
export const HIT_REACH_PX = 14;

interface Props {
	annotation: Annotation;
	/** Área de captura en px de imagen: origen del contenedor donde se monta. */
	selection: Rect;
	scale: { x: number; y: number };
}

/**
 * Zonas sensibles, INVISIBLES, de las manijas de la figura elegida. La figura
 * elegida no se dibuja con marco ni manijas: es el puntero (cursorFor) quien
 * indica el modo de edición. Esto solo fija dónde están esas zonas, en
 * coordenadas del área; los eventos los resuelve AnnotationCanvas con el mismo
 * radio (HIT_REACH_PX), así hay un único flujo de puntero.
 *
 * Excepción, el texto: no tiene línea dibujada que recorrer con el puntero para
 * descubrir sus manijas (un rectángulo sí), así que cuando está elegido muestra
 * un punto en cada manija. Los puntos no reciben eventos: solo señalan dónde
 * apuntar; la zona sensible sigue siendo la misma que en las demás figuras.
 */
export function AnnotationSelectionOverlay({
	annotation,
	selection,
	scale,
}: Props) {
	return (
		<div
			data-testid="annotation-selection"
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 overflow-hidden"
		>
			{annotation.kind === "text" && (
				<TextFrame
					annotation={annotation}
					selection={selection}
					scale={scale}
				/>
			)}
			{annotationHandles(annotation).map((h) => {
				const at = imageToArea(h.point, selection, scale);
				return (
					<span
						key={h.id}
						data-annotation-handle={h.id}
						className="absolute -translate-x-1/2 -translate-y-1/2"
						style={{
							left: at.x,
							top: at.y,
							width: HIT_REACH_PX * 2,
							height: HIT_REACH_PX * 2,
						}}
					>
						{annotation.kind === "text" && (
							<span
								data-handle-marker
								className="absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-[var(--color-accent)] bg-[var(--color-ann-white)]"
							/>
						)}
					</span>
				);
			})}
		</div>
	);
}

/**
 * Recuadro punteado del texto elegido (mismo borde que el campo de edición: acento,
 * 1 px, sin sombra): sin él no se ve el ancho real del recuadro, que es lo que
 * cambian las manijas e/w. Sigue al borrador durante el arrastre de una manija.
 */
function TextFrame({ annotation, selection, scale }: Props) {
	const box = annotationBox(annotation);
	const at = imageToArea({ x: box.x, y: box.y }, selection, scale);
	return (
		<div
			data-text-frame
			className="absolute box-border border border-dashed border-[var(--color-accent)]"
			style={{
				left: at.x,
				top: at.y,
				width: box.width * scale.x,
				height: box.height * scale.y,
			}}
		/>
	);
}
