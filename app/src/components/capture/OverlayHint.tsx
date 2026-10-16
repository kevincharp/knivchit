interface OverlayHintProps {
	onCancel: () => void;
}

/**
 * Barra fija en el borde superior mientras no hay selección: explica el gesto y
 * ofrece una salida que no depende del teclado (✕ «Cancelar»).
 */
export function OverlayHint({ onCancel }: OverlayHintProps) {
	return (
		<div
			data-capture-hint
			className="absolute top-6 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-[999px] bg-[var(--color-glass)] py-1.5 pr-1.5 pl-4 text-sm text-[var(--color-fg)] backdrop-blur-[20px] backdrop-saturate-150"
		>
			<span>Arrastra para seleccionar · Esc para cancelar</span>
			<button
				type="button"
				title="Cancelar"
				aria-label="Cancelar"
				onClick={onCancel}
				className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-fg)] transition-colors duration-[var(--duration-ui)] ease-out hover:bg-[var(--color-pill-hover)] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
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
