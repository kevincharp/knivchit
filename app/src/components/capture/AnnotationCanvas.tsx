import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { useRafCallback } from "../../lib/useRafCallback";
import {
	AnnotationSelectionOverlay,
	HIT_REACH_PX,
} from "./AnnotationSelectionOverlay";
import type { Tool } from "./annotationPalette";
import {
	type Annotation,
	type AnnotationHandleId,
	type AnnotationHistory,
	addAnnotation,
	annotationBox,
	annotationFontSize,
	annotationHandles,
	findAnnotationAt,
	findHandleAt,
	moveAnnotation,
	newTextBox,
	type Point,
	removeAnnotationAt,
	replaceAnnotation,
	resizeAnnotationHandle,
	type TextAlign,
	textFontSize,
	textWrapWidth,
} from "./annotations";
import { type CursorHit, cursorFor, NO_HIT } from "./cursors";
import { renderAnnotationsOnly } from "./renderAnnotations";
import type { Rect } from "./selection";
import { TextEditorField } from "./TextEditorField";
import { useTextSession } from "./useTextSession";

/** Lo que AnnotationCanvas ofrece a las capas que lo tapan (ver `layerRef`). */
export interface CanvasLayerApi {
	/** Si hay figura (o manija) bajo el puntero empieza su gesto y devuelve `true`. */
	grab: (e: ReactPointerEvent) => boolean;
	/** Cursor según lo que haya bajo el puntero, o `null` si no hay figura. */
	cursorAt: (e: ReactPointerEvent) => string | null;
	/** Doble clic: si hay un texto bajo el puntero lo elige y entra a editar su contenido. */
	editAt: (e: { clientX: number; clientY: number }) => boolean;
	/** Enter con un texto elegido: entra a editar su contenido. `false` si no hay texto elegido. */
	editSelected: () => boolean;
}

export interface ViewScale {
	/** Píxeles de pantalla por píxel de imagen. */
	x: number;
	y: number;
}

interface AnnotationCanvasProps {
	image: HTMLImageElement;
	selection: Rect;
	scale: ViewScale;
	tool: Tool | null;
	color: string;
	strokeWidth: number;
	/** Tamaño de fuente (px de imagen) de los textos nuevos; sin él se deriva del grosor. */
	fontSize?: number;
	/** Alineación de los textos nuevos; sin ella, a la izquierda. */
	textAlign?: TextAlign;
	history: AnnotationHistory;
	onHistoryChange: (history: AnnotationHistory) => void;
	/** Anotación elegida con la herramienta Seleccionar. */
	selectedId?: string | null;
	onSelect?: (id: string | null) => void;
	/**
	 * Entrada para las capas de encima (el marco del área): «¿hay una figura bajo
	 * el puntero? entonces el gesto es mío». Con Seleccionar, la figura gana al marco.
	 */
	layerRef?: RefObject<CanvasLayerApi | null>;
}

const MIN_SHAPE = 3;

/** Si el borrador edita una anotación existente la sustituye; si no, se apila encima. */
function withDraft(present: Annotation[], draft: Annotation | null) {
	if (!draft) return present;
	return present.some((a) => a.id === draft.id)
		? present.map((a) => (a.id === draft.id ? draft : a))
		: [...present, draft];
}

function samePointer(a: number | undefined, b: number | undefined) {
	return a === undefined || b === undefined || a === b;
}

/**
 * Capa de dibujo sobre la selección: solo pinta las anotaciones (transparente
 * donde no hay nada — el recorte real se ve de fondo a través del hueco de
 * SelectionFrame) y captura el puntero cuando hay una herramienta activa. Los
 * datos viven en annotations.ts; el pintado en vivo, en
 * renderAnnotations.ts#renderAnnotationsOnly (la composición final del PNG
 * usa renderSelection, en un canvas aparte, nunca esta vista).
 */
export function AnnotationCanvas({
	image,
	selection,
	scale,
	tool,
	color,
	strokeWidth,
	fontSize,
	textAlign,
	history,
	onHistoryChange,
	selectedId = null,
	onSelect,
	layerRef,
}: AnnotationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [draft, setDraft] = useState<Annotation | null>(null);
	// El gesto vive en un ref, no solo en estado: los listeners de `window` y
	// `lostpointercapture` leen siempre el último valor, sin cierres viejos.
	const gesture = useRef<{
		pointerId: number | undefined;
		draft: Annotation | null;
		erasing: boolean;
		/** Edición de una anotación existente (herramienta Seleccionar). */
		edit?: {
			original: Annotation;
			from: Point;
			handle: AnnotationHandleId | null;
			/** Distancia del punto agarrado al centro de la manija: el clic no la hace saltar bajo el puntero. */
			grabOffset: Point;
			/** Con Texto: si el gesto no mueve nada es un clic y entra a editar ese texto. */
			editOnClick?: boolean;
		};
	} | null>(null);
	// Evita un layout síncrono (getBoundingClientRect) en cada pointermove: la
	// posición del canvas solo cambia cuando cambian `selection` o `scale`,
	// así que se mide una vez por commit, no una vez por evento.
	const rectRef = useRef<DOMRect | null>(null);

	// Sesión de escritura de un texto (nuevo o existente): ver useTextSession.ts.
	const text = useTextSession({
		history,
		onHistoryChange,
		onSelect,
		makeText: (at) => {
			const size = fontSize ?? textFontSize(strokeWidth);
			const box = newTextBox(at, size, selection);
			const start = { x: box.x, y: at.y };
			return {
				id: crypto.randomUUID(),
				kind: "text",
				color,
				stroke_width: strokeWidth,
				start,
				end: start,
				text: "",
				// Ancho automático: crece al escribir hasta el borde derecho del área.
				max_right: box.right,
				...(textAlign && textAlign !== "left" ? { text_align: textAlign } : {}),
				...(fontSize ? { font_size: fontSize } : {}),
			};
		},
	});
	const editingId = text.session?.id ?? null;

	// Solo depende de selection/scale (no de draft/history): mientras se
	// dibuja una anotación la posición del canvas no cambia, así que esto no
	// vuelve a medir en cada punto del trazo.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selection/scale no se leen en el cuerpo, pero son la posición real del canvas
	useLayoutEffect(() => {
		rectRef.current = canvasRef.current?.getBoundingClientRect() ?? null;
	}, [selection, scale]);

	// Agrupa el redibujado de anotaciones a lo sumo una vez por frame: varios
	// cambios de `selection`/`draft` que llegan antes del próximo repintado
	// (p. ej. una ráfaga de pointermove más rápida de lo que WebKitGTK puede
	// componer) comparten un solo requestAnimationFrame en vez de un
	// renderAnnotationsOnly cada uno.
	// Lo que hay que pintar vive en un ref que el frame lee al correr (no los
	// argumentos con que se programó): si el historial se vacía antes de que llegue
	// el frame, este pinta lo actual (nada) y no resucita la figura anterior.
	const toDraw = useRef<Annotation[]>([]);
	const flushDraw = useRafCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		renderAnnotationsOnly(canvas, image, selection, toDraw.current);
	});

	// Mover/redimensionar sin anotaciones (el caso más común) ni siquiera llega
	// a programar un frame: el recorte real ya se ve de fondo a través del
	// hueco de SelectionFrame, así que basta con dejar el canvas en blanco.
	// biome-ignore lint/correctness/useExhaustiveDependencies: selection no se lee acá, pero flushDraw la cierra por dentro y hay que reprogramarlo cuando cambia
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const all = withDraft(history.present, draft).filter(
			(a) => a.id !== editingId,
		);
		toDraw.current = all;
		if (all.length === 0) {
			canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
			return;
		}
		flushDraw();
	}, [image, selection, history.present, draft, editingId, flushDraw]);

	// Cambiar de herramienta o de área termina la escritura en curso (la confirma).
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo reaccionan estos dos
	useEffect(() => {
		text.end();
	}, [tool, selection]);

	function toImagePoint(e: { clientX: number; clientY: number }) {
		const rect =
			rectRef.current ?? canvasRef.current?.getBoundingClientRect() ?? null;
		if (!rect || rect.width === 0 || rect.height === 0) {
			return { x: selection.x, y: selection.y };
		}
		return {
			x: selection.x + ((e.clientX - rect.left) / rect.width) * selection.w,
			y: selection.y + ((e.clientY - rect.top) / rect.height) * selection.h,
		};
	}

	function handleDown(e: ReactPointerEvent<HTMLCanvasElement>) {
		if (!tool || e.button !== 0) return;
		e.preventDefault();
		window.getSelection()?.removeAllRanges();
		// Un gesto sigue abierto (se perdió su pointerup): este clic lo cierra y
		// NO arranca otro, así nunca hace falta "clic–clic".
		if (gesture.current) {
			finishRef.current();
			return;
		}
		const p = toImagePoint(e);
		if (tool === "select") {
			beginSelect(e, p);
			return;
		}
		if (tool === "eraser") {
			gesture.current = { pointerId: e.pointerId, draft: null, erasing: true };
			lockCursor(cursorFor(tool, NO_HIT, true));
			capture(e);
			onHistoryChange(removeAnnotationAt(history, p));
			return;
		}
		if (tool === "text") {
			beginText(e, p);
			return;
		}
		const draftStart: Annotation = {
			id: crypto.randomUUID(),
			kind: tool,
			color,
			stroke_width: strokeWidth,
			start: p,
			end: p,
			...(tool === "pen" || tool === "mosaic" ? { points: [p] } : {}),
		};
		gesture.current = {
			pointerId: e.pointerId,
			draft: draftStart,
			erasing: false,
		};
		lockCursor(cursorFor(tool, NO_HIT, true));
		capture(e);
		setDraft(draftStart);
	}

	// Mismo criterio para elegir qué se agarra y para el cursor. Como la figura no
	// dibuja manijas, las de CUALQUIER figura son agarrables: primero las de la
	// elegida, luego las de la figura superior bajo el puntero, y al final su cuerpo.
	function pickTarget(
		p: Point,
		onlyText = false,
	): {
		target: Annotation | undefined;
		handle: AnnotationHandleId | null;
	} {
		const reach = HIT_REACH_PX / Math.min(scale.x, scale.y);
		const list = onlyText
			? history.present.filter((a) => a.kind === "text")
			: history.present;
		const current = list.find((a) => a.id === selectedId);
		const handle = current ? findHandleAt(current, p, reach) : null;
		if (current && handle) return { target: current, handle };
		const id = findAnnotationAt(list, p, reach);
		const target = list.find((a) => a.id === id);
		return {
			target,
			handle: target ? findHandleAt(target, p, reach) : null,
		};
	}

	function hitAt(p: Point): CursorHit {
		const { target, handle } = pickTarget(p);
		if (!target) return NO_HIT;
		return handle ? { kind: "handle", handle } : { kind: "annotation" };
	}

	// El cursor se cambia en el estilo del elemento, no en estado: un pointermove
	// no provoca ningún render. Durante un gesto también se fija en el documento,
	// porque con la captura del puntero el cursor puede salirse del canvas.
	function applyCursor(cursor: string) {
		if (canvasRef.current) canvasRef.current.style.cursor = cursor;
	}

	function lockCursor(cursor: string) {
		applyCursor(cursor);
		document.documentElement.style.cursor = cursor;
	}

	const flushHover = useRafCallback((clientX: number, clientY: number) => {
		if (gesture.current) return;
		const at = toImagePoint({ clientX, clientY });
		if (tool === "text") {
			// Con Texto, las manijas del texto elegido redimensionan; el resto es el cursor de texto.
			const { handle } = pickTarget(at, true);
			applyCursor(
				handle
					? cursorFor("select", { kind: "handle", handle }, false)
					: cursorFor(tool, NO_HIT, false),
			);
			return;
		}
		const hit = tool === "select" ? hitAt(at) : NO_HIT;
		applyCursor(cursorFor(tool, hit, false));
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: solo cuando cambia la herramienta
	useLayoutEffect(() => {
		applyCursor(cursorFor(tool, NO_HIT, false));
		return () => {
			document.documentElement.style.cursor = "";
		};
	}, [tool]);

	function beginSelect(e: ReactPointerEvent, p: Point) {
		const { target, handle } = pickTarget(p);
		onSelect?.(target?.id ?? null);
		if (!target) return;
		beginEditGesture(e, p, target, handle);
	}

	function beginEditGesture(
		e: ReactPointerEvent,
		p: Point,
		target: Annotation,
		handle: AnnotationHandleId | null,
		editOnClick = false,
	) {
		const anchor = handle
			? annotationHandles(target).find((h) => h.id === handle)?.point
			: undefined;
		const grabOffset = anchor
			? { x: anchor.x - p.x, y: anchor.y - p.y }
			: { x: 0, y: 0 };
		gesture.current = {
			pointerId: e.pointerId,
			draft: target,
			erasing: false,
			edit: { original: target, from: p, handle, grabOffset, editOnClick },
		};
		lockCursor(
			cursorFor(
				"select",
				handle ? { kind: "handle", handle } : { kind: "annotation" },
				true,
			),
		);
		capture(e);
	}

	// Clic con la herramienta Texto: cierra la escritura en curso (la confirma; un
	// campo vacío se descarta, no queda huérfano) y luego, según lo que haya bajo
	// el puntero: una manija del texto elegido lo redimensiona, un texto lo edita,
	// y en vacío empieza uno nuevo.
	function beginText(e: ReactPointerEvent, p: Point) {
		const { target, handle } = pickTarget(p, true);
		if (target && handle && !text.session) {
			// Arrastrar una manija redimensiona; pulsarla sin mover edita el texto.
			beginEditGesture(e, p, target, handle, true);
			return;
		}
		const wasEditing = text.session?.id;
		text.end();
		if (target && target.id !== wasEditing) {
			text.startEdit(target.id);
			return;
		}
		text.startNew(p);
	}

	// Entrada para las capas de encima (ver `layerRef`). Con Seleccionar y una
	// figura (o su manija) bajo el puntero, empieza el gesto de edición y avisa.
	// En vacío deselecciona y deja el gesto a quien preguntó.
	function tryGrab(e: ReactPointerEvent): boolean {
		if (tool !== "select" || e.button !== 0 || gesture.current) return false;
		const p = toImagePoint(e);
		if (!pickTarget(p).target) {
			onSelect?.(null);
			return false;
		}
		e.preventDefault();
		beginSelect(e, p);
		return true;
	}
	function cursorAt(e: ReactPointerEvent): string | null {
		if (tool !== "select") return null;
		const hit = hitAt(toImagePoint(e));
		return hit.kind === "none" ? null : cursorFor("select", hit, false);
	}
	function editAt(e: { clientX: number; clientY: number }): boolean {
		if (tool !== "select" && tool !== "text") return false;
		const { target } = pickTarget(toImagePoint(e), true);
		if (!target) return false;
		text.startEdit(target.id);
		return true;
	}
	function editSelected(): boolean {
		const current = history.present.find((a) => a.id === selectedId);
		if ((tool !== "select" && tool !== "text") || current?.kind !== "text") {
			return false;
		}
		text.startEdit(current.id);
		return true;
	}
	if (layerRef) {
		layerRef.current = { grab: tryGrab, cursorAt, editAt, editSelected };
	}

	function capture(e: ReactPointerEvent) {
		try {
			// Siempre el canvas: el gesto puede nacer en una capa de encima (el marco).
			canvasRef.current?.setPointerCapture(e.pointerId);
		} catch {
			// Sin captura el respaldo en `window` sigue cerrando el gesto.
		}
	}

	// El borrador del gesto vive en `gesture.current.draft` (un ref, se actualiza en
	// cada evento sin perder puntos) y solo se PUBLICA al estado una vez por frame:
	// un commit de React por pointermove rehacía, en cada evento, el reparto en
	// líneas, las manijas y las capas de encima (caro sobre todo en el texto). Si el
	// gesto ya terminó cuando llega el frame, no publica un borrador viejo.
	const publishDraft = useRafCallback((next: Annotation) => {
		if (gesture.current) setDraft(next);
	});

	function moveGesture(e: PointerEvent) {
		const g = gesture.current;
		if (!g || !samePointer(g.pointerId, e.pointerId)) return;
		const p = toImagePoint(e);
		if (g.erasing) {
			onHistoryChange(removeAnnotationAt(history, p));
			return;
		}
		if (!g.draft) return;
		if (g.edit) {
			const { original, from, handle, grabOffset } = g.edit;
			const edited = handle
				? resizeAnnotationHandle(original, handle, {
						x: p.x + grabOffset.x,
						y: p.y + grabOffset.y,
					})
				: moveAnnotation(original, p.x - from.x, p.y - from.y);
			g.draft = edited;
			publishDraft(edited);
			return;
		}
		const next: Annotation =
			g.draft.kind === "pen" || g.draft.kind === "mosaic"
				? { ...g.draft, end: p, points: [...(g.draft.points ?? []), p] }
				: { ...g.draft, end: p };
		g.draft = next;
		publishDraft(next);
	}

	// Cierra el gesto UNA vez: pointerup, pointercancel y lostpointercapture
	// confirman lo dibujado (cancelar a mitad no debe perder el trabajo del
	// usuario ni dejar la forma colgada); si ya no hay gesto, no hace nada.
	function finishGesture() {
		const g = gesture.current;
		if (!g) return;
		gesture.current = null;
		document.documentElement.style.cursor = "";
		applyCursor(cursorFor(tool, NO_HIT, false));
		const d = g.draft;
		setDraft(null);
		if (!d) return;
		if (g.edit) {
			// Por valor: arrastrar y volver al origen tampoco es una edición.
			if (JSON.stringify(d) !== JSON.stringify(g.edit.original)) {
				onHistoryChange(replaceAnnotation(history, d));
			} else if (g.edit.editOnClick) {
				text.startEdit(g.edit.original.id);
			}
			return;
		}
		const big =
			d.kind === "pen" ||
			d.kind === "mosaic" ||
			Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) >= MIN_SHAPE;
		if (big) onHistoryChange(addAnnotation(history, d));
	}

	// Siempre apunta a los closures del último render.
	const finishRef = useRef(finishGesture);
	finishRef.current = finishGesture;
	const moveRef = useRef(moveGesture);
	moveRef.current = moveGesture;

	// Respaldo en window: soltar fuera del canvas o sobre otra capa, o un
	// navegador que no reenvía el evento al elemento con la captura, termina
	// igual el gesto.
	useEffect(() => {
		const onMove = (e: PointerEvent) => moveRef.current(e);
		const onEnd = (e: PointerEvent) => {
			const g = gesture.current;
			if (g && samePointer(g.pointerId, e.pointerId)) finishRef.current();
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onEnd);
		window.addEventListener("pointercancel", onEnd);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onEnd);
			window.removeEventListener("pointercancel", onEnd);
		};
	}, []);

	const visible = withDraft(history.present, draft);
	const selectedAnnotation = selectedId
		? visible.find((a) => a.id === selectedId)
		: undefined;
	// La anotación en escritura (con el borrador de un gesto, si lo hay): el campo
	// sigue sus cambios de tamaño, ancho, color y alineación.
	const editing = editingId
		? visible.find((a) => a.id === editingId)
		: undefined;
	// Campo de escritura: con ancho fijo, el del recuadro; con ancho automático, el
	// del contenido más una letra de holgura (para que la siguiente que se teclee
	// no baje de línea antes de que el recuadro la alcance), sin pasar del tope. La
	// holgura se descuenta del lado de la alineación para no mover el texto.
	const fieldGeometry = (() => {
		if (!editing) return { width: 0, dx: 0 };
		if (editing.box_width) return { width: editing.box_width, dx: 0 };
		const box = annotationBox(editing);
		const limit = textWrapWidth(editing) ?? box.width;
		const width = Math.min(limit, box.width + annotationFontSize(editing));
		const extra = width - box.width;
		const align = editing.text_align ?? "left";
		return {
			width,
			dx: align === "center" ? -extra / 2 : align === "right" ? -extra : 0,
		};
	})();

	return (
		<div
			className="absolute"
			style={{
				left: selection.x * scale.x,
				top: selection.y * scale.y,
				width: selection.w * scale.x,
				height: selection.h * scale.y,
			}}
			// Las manijas del texto en escritura caen SOBRE el campo: se atienden aquí,
			// antes que él, y sin pulsar el ratón sobre el campo no pierde el foco ni lo escrito.
			onPointerDownCapture={(e) => {
				if (!editing || e.button !== 0 || gesture.current) return;
				const p = toImagePoint(e);
				const handle = findHandleAt(
					editing,
					p,
					HIT_REACH_PX / Math.min(scale.x, scale.y),
				);
				if (!handle) return;
				e.preventDefault();
				e.stopPropagation();
				beginEditGesture(e, p, editing, handle);
			}}
			onPointerMoveCapture={(e) => {
				if (!editing || gesture.current || e.target === canvasRef.current) {
					return;
				}
				const handle = findHandleAt(
					editing,
					toImagePoint(e),
					HIT_REACH_PX / Math.min(scale.x, scale.y),
				);
				(e.target as HTMLElement).style.cursor = handle
					? cursorFor("select", { kind: "handle", handle }, false)
					: "";
			}}
		>
			<canvas
				ref={canvasRef}
				role="img"
				aria-label="Vista previa de la selección con anotaciones"
				className="block h-full w-full"
				style={{
					pointerEvents: tool ? "auto" : "none",
					touchAction: "none",
				}}
				onPointerDown={handleDown}
				onDoubleClick={(e) => editAt(e)}
				onPointerMove={(e) => flushHover(e.clientX, e.clientY)}
				onLostPointerCapture={() => finishRef.current()}
			/>
			{(tool === "select" || tool === "text") &&
				selectedAnnotation &&
				(tool === "select" || selectedAnnotation.kind === "text") && (
					<AnnotationSelectionOverlay
						annotation={selectedAnnotation}
						selection={selection}
						scale={scale}
					/>
				)}
			{editing && text.session && (
				<TextEditorField
					key={editing.id}
					label={
						text.session.isNew ? "Texto de la anotación" : "Editar el texto"
					}
					left={(editing.start.x + fieldGeometry.dx - selection.x) * scale.x}
					top={(editing.start.y - selection.y) * scale.y}
					fontPx={annotationFontSize(editing) * scale.y}
					widthPx={fieldGeometry.width * scale.x}
					align={editing.text_align}
					color={editing.color}
					initial={editing.text}
					enterCommits={text.session.isNew}
					onChange={text.sync}
					onCommit={text.end}
				/>
			)}
		</div>
	);
}
