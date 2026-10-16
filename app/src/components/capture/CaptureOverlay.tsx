import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cancelCapture, getCapturePreview } from "../../lib/tauri";
import { useNativeDragGuard } from "../../lib/useNativeDragGuard";
import {
	AnnotationCanvas,
	type CanvasLayerApi,
	type ViewScale,
} from "./AnnotationCanvas";
import {
	ANNOTATION_COLORS,
	resolveToken,
	type Tool,
} from "./annotationPalette";
import {
	annotationFontSize,
	canRedo,
	canUndo,
	createHistory,
	MAX_TEXT_FONT_SIZE,
	MIN_TEXT_FONT_SIZE,
	redo,
	removeAnnotation,
	type TextAlign,
	textFontSize,
	undo,
	updateAnnotation,
} from "./annotations";
import { CaptureToolbar } from "./CaptureToolbar";
import { OverlayHint } from "./OverlayHint";
import { SelectionFrame } from "./SelectionFrame";
import { ShortcutsHelp } from "./ShortcutsHelp";
import {
	clampRect,
	MIN_SELECTION,
	placeToolbar,
	type Rect,
	rectFromPoints,
	type Size,
} from "./selection";
import { ToolOptions } from "./ToolOptions";
import { useCaptureActivity } from "./useCaptureActivity";
import { useCaptureOutput } from "./useCaptureOutput";
import { useCaptureShortcuts } from "./useCaptureShortcuts";

/**
 * Muestra la ventana y fuerza el foco de teclado hasta el webview: sin él Esc
 * no llega y el overlay quedaría sin salida. Los permisos que falten se toleran.
 */
function showAndFocus(root: HTMLElement | null) {
	const win = getCurrentWindow();
	win.show();
	win.setFocus();
	try {
		getCurrentWebview()
			.setFocus()
			.catch(() => {});
	} catch {
		// Sin webview disponible (tests o permiso denegado): el resto basta.
	}
	window.focus();
	root?.focus();
}

/**
 * Ventana fullscreen sin decoración que se abre sobre una foto ya congelada
 * de la pantalla (ver capture::capture_full_screen). Orquesta: la selección y
 * el dibujo trabajan en píxeles de la imagen (factor = natural / ventana), nunca
 * en devicePixelRatio, para que el recorte sea exacto con escalado fraccional.
 */
export function CaptureOverlay() {
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	// Si la foto no llega, el overlay se muestra igual con el error: una ventana
	// oculta dejaría al usuario sin UI (la principal está oculta mientras existe).
	const [loadError, setLoadError] = useState<string | null>(null);
	const [image, setImage] = useState<HTMLImageElement | null>(null);
	const [viewport, setViewport] = useState<Size>({
		w: window.innerWidth,
		h: window.innerHeight,
	});
	const [selection, setSelection] = useState<Rect | null>(null);
	const [creating, setCreating] = useState(false);
	const [tool, setTool] = useState<Tool | null>(null);
	const [colorId, setColorId] = useState<string>(ANNOTATION_COLORS[0].id);
	const [strokeWidth, setStrokeWidth] = useState(4);
	// Tamaño de fuente de los textos nuevos (px de imagen); el del elegido se lee de él.
	const [textSize, setTextSize] = useState(textFontSize(4));
	const [textAlign, setTextAlign] = useState<TextAlign>("left");
	const [history, setHistory] = useState(createHistory);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [toolbarSize, setToolbarSize] = useState<Size>({ w: 0, h: 0 });
	const anchor = useRef<{ x: number; y: number } | null>(null);
	const layerRef = useRef<CanvasLayerApi | null>(null);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	useNativeDragGuard({ blockMouseDown: true });

	const failLoad = useCallback((reason: unknown) => {
		setLoadError(reason instanceof Error ? reason.message : String(reason));
		showAndFocus(null);
	}, []);

	useEffect(() => {
		getCapturePreview().then(setImageUrl).catch(failLoad);
	}, [failLoad]);

	useEffect(() => {
		const onResize = () =>
			setViewport({ w: window.innerWidth, h: window.innerHeight });
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const scale: ViewScale = useMemo(
		() =>
			image
				? {
						x: viewport.w / image.naturalWidth,
						y: viewport.h / image.naturalHeight,
					}
				: { x: 1, y: 1 },
		[image, viewport],
	);
	const bounds: Size = image
		? { w: image.naturalWidth, h: image.naturalHeight }
		: { w: 0, h: 0 };

	const color = useMemo(() => {
		const entry = ANNOTATION_COLORS.find((c) => c.id === colorId);
		return entry ? resolveToken(entry.token) : "";
	}, [colorId]);

	// Elegida: con Seleccionar, cualquier figura; con Texto, solo un texto (el que
	// se acaba de escribir queda elegido para seguir editándolo).
	const pickedAnnotation = history.present.find((a) => a.id === selectedId);
	const selectedAnnotation =
		tool === "select" || (tool === "text" && pickedAnnotation?.kind === "text")
			? pickedAnnotation
			: undefined;

	// Con Seleccionar, color y grosor son los de la anotación elegida y los
	// cambios se aplican a ella (un paso de historial, deshacible).
	const optionsTool: Tool | null =
		tool === "select" ? (selectedAnnotation?.kind ?? null) : tool;
	const shownColorId = selectedAnnotation
		? (ANNOTATION_COLORS.find(
				(c) => resolveToken(c.token) === selectedAnnotation.color,
			)?.id ?? colorId)
		: colorId;
	const shownStrokeWidth = selectedAnnotation?.stroke_width ?? strokeWidth;
	const shownFontSize =
		selectedAnnotation?.kind === "text"
			? annotationFontSize(selectedAnnotation)
			: textSize;

	const shownTextAlign: TextAlign =
		selectedAnnotation?.kind === "text"
			? (selectedAnnotation.text_align ?? "left")
			: textAlign;

	// La alineación vale para el texto elegido (un paso de historial) y para el siguiente.
	function changeTextAlign(align: TextAlign) {
		setTextAlign(align);
		if (selectedAnnotation?.kind === "text") {
			setHistory((h) =>
				updateAnnotation(h, selectedAnnotation.id, { text_align: align }),
			);
		}
	}

	// El tamaño elegido vale para el texto elegido y para el siguiente que se escriba.
	function changeFontSize(size: number) {
		const next = Math.min(
			MAX_TEXT_FONT_SIZE,
			Math.max(MIN_TEXT_FONT_SIZE, size),
		);
		setTextSize(next);
		if (selectedAnnotation?.kind === "text") {
			setHistory((h) =>
				updateAnnotation(h, selectedAnnotation.id, { font_size: next }),
			);
		}
	}

	function changeColor(id: string) {
		setColorId(id);
		const entry = ANNOTATION_COLORS.find((c) => c.id === id);
		if (selectedAnnotation && entry) {
			const next = resolveToken(entry.token);
			setHistory((h) =>
				updateAnnotation(h, selectedAnnotation.id, { color: next }),
			);
		}
	}

	function changeStrokeWidth(width: number) {
		setStrokeWidth(width);
		if (selectedAnnotation) {
			setHistory((h) =>
				updateAnnotation(h, selectedAnnotation.id, { stroke_width: width }),
			);
		}
	}

	function changeTool(next: Tool | null) {
		setTool(next);
		if (next !== "select" && next !== "text") setSelectedId(null);
	}

	const notifyActivity = useCaptureActivity();
	useEffect(() => {
		if (selection) notifyActivity("selection");
	}, [selection, notifyActivity]);
	useEffect(() => {
		if (tool) notifyActivity("tool");
	}, [tool, notifyActivity]);

	const { run, busy, error } = useCaptureOutput({
		image,
		selection,
		annotations: history.present,
		scale,
	});

	const handleCancel = useCallback(async () => {
		try {
			await cancelCapture();
		} catch {
			// Si no hay captura pendiente que descartar, igual hay que cerrar.
		}
		await getCurrentWindow().close();
	}, []);

	useCaptureShortcuts({
		// Esc cierra la ayuda, luego deselecciona; sin nada de eso, cancela la captura.
		onCancel: () => {
			if (helpOpen) setHelpOpen(false);
			else if (selectedAnnotation) setSelectedId(null);
			else handleCancel();
		},
		// Pulsar el atajo de la herramienta activa la apaga, igual que el clic.
		onToolKey: (t) => {
			if (selection && !creating) changeTool(tool === t ? null : t);
		},
		onHelp: () => setHelpOpen((o) => !o),
		onDeleteSelected: () => {
			if (!selectedAnnotation) return;
			setHistory((h) => removeAnnotation(h, selectedAnnotation.id));
			setSelectedId(null);
		},
		onEditSelected: () => layerRef.current?.editSelected() ?? false,
		onConfirm: () => run("copy"),
		onCopy: () => run("copy"),
		onSave: () => run("save"),
		onSaveAs: () => run("save-as"),
		onUndo: () => setHistory(undo),
		onRedo: () => setHistory(redo),
	});

	useLayoutEffect(() => {
		const el = toolbarRef.current;
		if (!el) return;
		if (el.offsetWidth !== toolbarSize.w || el.offsetHeight !== toolbarSize.h) {
			setToolbarSize({ w: el.offsetWidth, h: el.offsetHeight });
		}
	});

	function toImage(e: ReactPointerEvent): { x: number; y: number } {
		return { x: e.clientX / scale.x, y: e.clientY / scale.y };
	}

	function handleDown(e: ReactPointerEvent) {
		if (e.button !== 0 || e.target !== e.currentTarget || !image) return;
		e.preventDefault();
		window.getSelection()?.removeAllRanges();
		e.currentTarget.setPointerCapture(e.pointerId);
		anchor.current = toImage(e);
		setCreating(true);
		setSelection(null);
		setHistory(createHistory());
		setTool(null);
		setSelectedId(null);
	}

	function handleMove(e: ReactPointerEvent) {
		if (!anchor.current) return;
		setSelection(clampRect(rectFromPoints(anchor.current, toImage(e)), bounds));
	}

	function handleUp() {
		if (!anchor.current) return;
		anchor.current = null;
		setCreating(false);
		setSelection((s) =>
			s && s.w >= MIN_SELECTION && s.h >= MIN_SELECTION ? s : null,
		);
	}

	function changeSelection(next: Rect) {
		setSelection(next);
	}

	if (loadError) {
		return (
			<button
				type="button"
				onClick={handleCancel}
				className="fixed inset-0 flex cursor-pointer items-center justify-center bg-[var(--color-bg)] p-8"
			>
				<span
					role="alert"
					className="rounded-[var(--radius-ui)] bg-[var(--color-glass)] px-6 py-4 text-center text-[var(--color-fg)] backdrop-blur-[20px] backdrop-saturate-150"
				>
					No se pudo cargar la captura: {loadError}
					<span className="mt-2 block text-sm text-[var(--color-fg-muted)]">
						Pulsa Esc o haz clic para cerrar.
					</span>
				</span>
			</button>
		);
	}

	if (!imageUrl) return null;

	const placed =
		selection && !creating && toolbarSize.w > 0
			? placeToolbar(
					{
						x: selection.x * scale.x,
						y: selection.y * scale.y,
						w: selection.w * scale.x,
						h: selection.h * scale.y,
					},
					toolbarSize,
					viewport,
				)
			: null;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: superficie de selección con puntero; el teclado opera sobre el marco, la toolbar y los atajos globales
		<div
			ref={rootRef}
			tabIndex={-1}
			className="capture-surface fixed inset-0 overflow-hidden outline-none"
			style={{ cursor: "crosshair", touchAction: "none" }}
			onContextMenu={(e) => {
				e.preventDefault();
				handleCancel();
			}}
			onPointerDown={handleDown}
			onPointerMove={handleMove}
			onPointerUp={handleUp}
			onPointerCancel={handleUp}
		>
			<img
				src={imageUrl}
				draggable={false}
				alt=""
				onError={() => failLoad("la imagen no se pudo leer")}
				onLoad={(e) => {
					setImage(e.currentTarget);
					showAndFocus(rootRef.current);
				}}
				className="pointer-events-none absolute inset-0 h-full w-full"
				style={{ objectFit: "fill" }}
			/>

			{image && selection && (
				<>
					<AnnotationCanvas
						image={image}
						selection={selection}
						scale={scale}
						tool={tool}
						color={color}
						strokeWidth={strokeWidth}
						fontSize={textSize}
						textAlign={textAlign}
						history={history}
						onHistoryChange={setHistory}
						selectedId={selectedId}
						onSelect={setSelectedId}
						layerRef={layerRef}
					/>
					<SelectionFrame
						selection={selection}
						scale={scale}
						bounds={bounds}
						viewport={viewport}
						canMove={tool === null || tool === "select"}
						yieldGesture={(e) => layerRef.current?.grab(e) ?? false}
						cursorAt={(e) => layerRef.current?.cursorAt(e) ?? null}
						onEditAt={(e) => layerRef.current?.editAt(e)}
						onChange={changeSelection}
					/>
				</>
			)}

			{selection && !creating && (
				// biome-ignore lint/a11y/noStaticElementInteractions: no es un control; solo evita que pulsar sus botones quite el foco al texto
				<div
					ref={toolbarRef}
					className="absolute flex flex-col items-center gap-2"
					// Pulsar un botón de la barra o de las opciones no le roba el foco al
					// texto que se está escribiendo: el cambio se aplica a ese texto en vivo.
					onMouseDown={(e) => e.preventDefault()}
					style={{
						left: placed?.left ?? 0,
						top: placed?.top ?? 0,
						transform: "translateX(-50%)",
						visibility: placed ? "visible" : "hidden",
					}}
				>
					<CaptureToolbar
						tool={tool}
						onToolChange={changeTool}
						canUndo={canUndo(history)}
						canRedo={canRedo(history)}
						onUndo={() => setHistory(undo)}
						onRedo={() => setHistory(redo)}
						onPin={() => run("pin")}
						onSave={() => run("save")}
						onSaveAs={() => run("save-as")}
						onCancel={handleCancel}
						onConfirm={() => run("copy")}
						busy={busy}
					/>
					<ToolOptions
						tool={optionsTool}
						color={shownColorId}
						onColorChange={changeColor}
						strokeWidth={shownStrokeWidth}
						onStrokeWidthChange={changeStrokeWidth}
						fontSize={shownFontSize}
						onFontSizeChange={changeFontSize}
						textAlign={shownTextAlign}
						onTextAlignChange={changeTextAlign}
					/>
				</div>
			)}

			{helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}

			{!selection && !creating && <OverlayHint onCancel={handleCancel} />}

			{error && (
				<p
					role="alert"
					className="absolute top-6 left-1/2 -translate-x-1/2 cursor-default rounded-full bg-[var(--color-glass)] px-4 py-2 text-sm text-[var(--color-accent-warm)] backdrop-blur-[20px] backdrop-saturate-150"
				>
					No se pudo completar la captura: {error}
				</p>
			)}
		</div>
	);
}
