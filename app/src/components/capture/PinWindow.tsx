import { useEffect, useState } from "react";
import { closePin, getPinImage } from "../../lib/tauri";
import { useNativeDragGuard } from "../../lib/useNativeDragGuard";

/**
 * Ventana flotante con una captura fijada. La URL trae `?window=pin&label=pin-<uuid>`.
 * Se arrastra desde cualquier punto de la imagen y se cierra con Esc
 * o el botón de cierre.
 */
export function PinWindow() {
	const label = new URLSearchParams(window.location.search).get("label") ?? "";
	const [src, setSrc] = useState<string | null>(null);
	// Sin cancelar mousedown: data-tauri-drag-region arrastra la ventana con él.
	useNativeDragGuard();

	useEffect(() => {
		if (label) getPinImage(label).then(setSrc);
	}, [label]);

	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") closePin(label);
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [label]);

	if (!src) return null;

	return (
		<div
			data-tauri-drag-region
			className="capture-surface group fixed inset-0 overflow-hidden rounded-[var(--radius-ui)] border border-[var(--color-pill-border)]"
		>
			<img
				src={src}
				alt="Captura fijada en pantalla"
				draggable={false}
				data-tauri-drag-region
				className="h-full w-full select-none"
				style={{ objectFit: "fill" }}
			/>
			<button
				type="button"
				aria-label="Cerrar captura fijada"
				title="Cerrar captura fijada"
				onClick={() => closePin(label)}
				className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-glass)] text-[var(--color-fg)] opacity-0 backdrop-blur-[20px] backdrop-saturate-150 transition-opacity duration-[var(--duration-ui)] ease-out group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none"
			>
				<svg
					viewBox="0 0 24 24"
					width="14"
					height="14"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.8"
					strokeLinecap="round"
					aria-hidden="true"
				>
					<path d="M6 6l12 12M18 6 6 18" />
				</svg>
			</button>
		</div>
	);
}
