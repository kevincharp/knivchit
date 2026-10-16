import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useRef,
} from "react";
import { useRafCallback } from "../../lib/useRafCallback";
import type { ViewScale } from "./AnnotationCanvas";
import {
	HANDLE_ANCHORS,
	HANDLE_CURSORS,
	HANDLE_IDS,
	type HandleId,
	moveRect,
	type Rect,
	resizeRect,
	type Size,
} from "./selection";

interface SelectionFrameProps {
	/** Selección en px de imagen. */
	selection: Rect;
	scale: ViewScale;
	/** Tamaño de la imagen en px, límite de la selección. */
	bounds: Size;
	/** Tamaño de la ventana en px de pantalla, para el enmascarado exterior. */
	viewport: Size;
	/** Si es falso (hay una herramienta de dibujo activa) el cuerpo no arrastra; las manijas sí. */
	canMove: boolean;
	/**
	 * Se consulta antes de iniciar un gesto (cuerpo o manija). Si devuelve `true`
	 * una figura se quedó el gesto y el marco no lo toma: la figura va encima.
	 */
	yieldGesture?: (e: ReactPointerEvent) => boolean;
	/** Cursor del cuerpo si hay una figura bajo el puntero; `null` para el del marco. */
	cursorAt?: (e: ReactPointerEvent) => string | null;
	/** Doble clic sobre el cuerpo: la capa de figuras decide si es un texto que editar. */
	onEditAt?: (e: { clientX: number; clientY: number }) => void;
	onChange: (selection: Rect) => void;
}

type Drag = {
	handle: HandleId | "move";
	startX: number;
	startY: number;
	origin: Rect;
};

/**
 * Marco de la selección: enmascara lo de fuera, dibuja el borde redondeado,
 * 8 manijas y la etiqueta `ancho × alto`. Sin sombras: el exterior se oscurece
 * con una máscara SVG.
 */
export function SelectionFrame({
	selection,
	scale,
	bounds,
	viewport,
	canMove,
	yieldGesture,
	cursorAt,
	onEditAt,
	onChange,
}: SelectionFrameProps) {
	const drag = useRef<Drag | null>(null);
	const left = selection.x * scale.x;
	const top = selection.y * scale.y;
	const width = selection.w * scale.x;
	const height = selection.h * scale.y;
	const radius = Math.min(24, width / 2, height / 2);
	const labelInside = top < 32;

	function begin(handle: Drag["handle"], e: ReactPointerEvent) {
		if (e.button !== 0) return;
		if (yieldGesture?.(e)) {
			e.stopPropagation();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		// El mousedown cancelado (anti-arrastre nativo) tampoco da foco: se pide a mano para las flechas.
		if (handle === "move") {
			const el = e.currentTarget as HTMLElement;
			el.focus();
			// Moviendo el recuadro, la mano cerrada; las manijas conservan su flecha direccional.
			el.style.cursor = "grabbing";
		}
		e.currentTarget.setPointerCapture(e.pointerId);
		drag.current = {
			handle,
			startX: e.clientX,
			startY: e.clientY,
			origin: selection,
		};
	}

	// Agrupa el arrastre a lo sumo una vez por frame: en WebKitGTK una ráfaga
	// de pointermove más rápida que el repintado se acumulaba en una cola que
	// se vaciaba de golpe (el salto/titileo reportado). moveRect/resizeRect
	// son funciones puras de la posición final, así que descartar eventos
	// intermedios del mismo frame no pierde nada.
	const flushUpdate = useRafCallback((clientX: number, clientY: number) => {
		const d = drag.current;
		if (!d) return;
		const dx = (clientX - d.startX) / scale.x;
		const dy = (clientY - d.startY) / scale.y;
		onChange(
			d.handle === "move"
				? moveRect(d.origin, dx, dy, bounds)
				: resizeRect(d.origin, d.handle, dx, dy, bounds),
		);
	});

	function update(e: ReactPointerEvent) {
		if (!drag.current) return;
		flushUpdate(e.clientX, e.clientY);
	}

	function end(e: ReactPointerEvent) {
		if (drag.current?.handle === "move") {
			(e.currentTarget as HTMLElement).style.cursor = canMove
				? "move"
				: "crosshair";
		}
		drag.current = null;
	}

	// Sin gesto en curso, el cuerpo muestra el cursor de la figura que tenga debajo.
	function hoverBody(e: ReactPointerEvent) {
		if (drag.current) return;
		(e.currentTarget as HTMLElement).style.cursor =
			cursorAt?.(e) ?? (canMove ? "move" : "crosshair");
	}

	function onKeyDown(e: ReactKeyboardEvent) {
		const step = e.shiftKey ? 10 : 1;
		const delta: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, -step],
			ArrowDown: [0, step],
		};
		const d = delta[e.key];
		if (!d) return;
		e.preventDefault();
		// Ctrl+flechas redimensiona el borde derecho/inferior; sin Ctrl, mueve.
		onChange(
			e.ctrlKey
				? resizeRect(selection, "se", d[0], d[1], bounds)
				: moveRect(selection, d[0], d[1], bounds),
		);
	}

	return (
		<>
			<svg
				className="pointer-events-none absolute inset-0"
				width={viewport.w}
				height={viewport.h}
				aria-hidden="true"
			>
				<defs>
					<mask id="selection-cutout">
						<rect width="100%" height="100%" fill="white" />
						<rect
							x={left}
							y={top}
							width={width}
							height={height}
							rx={radius}
							fill="black"
						/>
					</mask>
				</defs>
				<rect
					width="100%"
					height="100%"
					fill="var(--color-scrim)"
					mask="url(#selection-cutout)"
				/>
			</svg>

			<button
				type="button"
				aria-label={`Área de captura, ${selection.w} por ${selection.h} píxeles. Flechas mueven, Ctrl más flechas redimensiona`}
				className="absolute border-2 border-[var(--color-accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-fg)]"
				style={{
					left,
					top,
					width,
					height,
					borderRadius: radius,
					backgroundColor: canMove
						? "var(--color-selection-fill)"
						: "transparent",
					cursor: canMove ? "move" : "crosshair",
					pointerEvents: canMove ? "auto" : "none",
				}}
				onPointerDown={(e) => begin("move", e)}
				onDoubleClick={(e) => onEditAt?.(e)}
				onPointerMove={(e) => {
					update(e);
					hoverBody(e);
				}}
				onPointerUp={end}
				onPointerCancel={end}
				onKeyDown={onKeyDown}
			/>

			{/* Sin backdrop-filter: se reposiciona en cada frame del arrastre, y el
			    blur es caro en WebKitGTK. --color-glass-solid compensa sin él. */}
			<span
				className="pointer-events-none absolute rounded-full bg-[var(--color-glass-solid)] px-2.5 py-0.5 font-mono text-xs text-[var(--color-fg)]"
				style={{
					left: left + (labelInside ? 8 : 0),
					top: top + (labelInside ? 8 : -28),
				}}
			>
				{selection.w} × {selection.h}
			</span>

			{HANDLE_IDS.map((id) => {
				const { fx, fy } = HANDLE_ANCHORS[id];
				return (
					<div
						key={id}
						data-handle={id}
						className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
						style={{
							left: left + width * fx,
							top: top + height * fy,
							cursor: HANDLE_CURSORS[id],
							touchAction: "none",
						}}
						onPointerDown={(e) => begin(id, e)}
						onPointerMove={update}
						onPointerUp={end}
						onPointerCancel={end}
					>
						<span className="h-2.5 w-2.5 rounded-[2px] border border-[var(--color-bg)] bg-[var(--color-accent)]" />
					</div>
				);
			})}
		</>
	);
}
