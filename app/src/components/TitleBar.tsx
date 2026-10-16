import { closeCurrentWindow, minimizeCurrentWindow } from "../lib/tauri";
import { LogoMark } from "./LogoMark";

const BUTTON =
	"flex h-9 w-9 items-center justify-center rounded-[var(--radius-sharp)] text-[var(--color-fg-muted)] transition-colors duration-[var(--duration-ui)] ease-out hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none";

function Icon({ children }: { children: React.ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			width="20"
			height="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

/**
 * Barra de título propia de la ventana principal (sin decoraciones nativas).
 * Toda la barra arrastra la ventana; los botones no.
 */
export function TitleBar() {
	return (
		<header
			data-tauri-drag-region
			className="flex h-10 shrink-0 select-none items-center justify-between pr-1 pl-3.5"
		>
			<span
				data-tauri-drag-region
				className="flex items-center gap-2 text-sm font-medium text-[var(--color-fg)]"
			>
				<LogoMark />
				Knivchit
			</span>
			<div className="flex items-center gap-1">
				<button
					type="button"
					aria-label="Minimizar"
					title="Minimizar"
					onClick={() => minimizeCurrentWindow()}
					className={BUTTON}
				>
					<Icon>
						<path d="M6 12h12" />
					</Icon>
				</button>
				<button
					type="button"
					aria-label="Cerrar"
					title="Cerrar"
					onClick={() => closeCurrentWindow()}
					className={BUTTON}
				>
					<Icon>
						<path d="M6 6l12 12M18 6 6 18" />
					</Icon>
				</button>
			</div>
		</header>
	);
}
