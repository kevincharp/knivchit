import {
	type FocusEvent,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { ICON_VIEWBOX } from "./toolbarIcons";

interface ToolbarButtonProps {
	label: string;
	children: ReactNode;
	onClick?: () => void;
	pressed?: boolean;
	/** Para los botones «Próximamente»: se ven, no se pueden usar. */
	comingSoon?: boolean;
	disabled?: boolean;
	primary?: boolean;
	/** Atajo para el tooltip propio (`Alt+F · F`). */
	shortcut?: string;
	/** Valor de `aria-keyshortcuts` (alternativas separadas por espacios). */
	keyShortcuts?: string;
}

const MARGIN = 8;

/**
 * Botón redondo de la píldora. El nombre accesible es `aria-label`; no lleva
 * `title` porque tiene tooltip propio, que sale con el ratón o con el foco de
 * teclado, se cierra con Esc (sin cancelar la captura) y se recoloca si se
 * saldría de la pantalla.
 */
export function ToolbarButton({
	label,
	children,
	onClick,
	pressed,
	comingSoon,
	disabled,
	primary,
	shortcut,
	keyShortcuts,
}: ToolbarButtonProps) {
	const inactive = disabled || comingSoon;
	const [hover, setHover] = useState(false);
	const [keyboardFocus, setKeyboardFocus] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [place, setPlace] = useState({ above: false, dx: 0 });
	const tipRef = useRef<HTMLSpanElement>(null);
	const visible = (hover || keyboardFocus) && !dismissed;

	// Esc cierra el tooltip y no llega al resto de atajos: el primer Esc quita
	// el tooltip, el segundo cancela la captura. Escucha en la fase de captura de
	// window, antes que los listeners de document.
	useEffect(() => {
		if (!visible) return;
		function onKey(e: KeyboardEvent) {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			setDismissed(true);
		}
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [visible]);

	// Debajo del botón (por debajo de la píldora); si no cabe, encima; y
	// desplazado en horizontal si se saldría por un lado.
	useLayoutEffect(() => {
		if (!visible) {
			setPlace({ above: false, dx: 0 });
			return;
		}
		const r = tipRef.current?.getBoundingClientRect();
		if (!r) return;
		const above = r.bottom > window.innerHeight - MARGIN;
		const dx =
			r.left < MARGIN
				? MARGIN - r.left
				: r.right > window.innerWidth - MARGIN
					? window.innerWidth - MARGIN - r.right
					: 0;
		if (above || dx) setPlace({ above, dx });
	}, [visible]);

	function onFocus(e: FocusEvent) {
		setKeyboardFocus((e.target as Element).matches(":focus-visible"));
	}
	function onBlur() {
		setKeyboardFocus(false);
		setDismissed(false);
	}

	const tone = primary
		? "bg-[var(--color-bg)] text-[var(--color-fg)]"
		: pressed
			? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]"
			: "text-[var(--color-toolbar-icon)] hover:bg-[var(--color-pill-hover)]";
	const detail = comingSoon ? "Próximamente" : shortcut;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: solo observa ratón y foco para el tooltip; el control es el botón
		<span
			className="relative inline-flex"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => {
				setHover(false);
				setDismissed(false);
			}}
			onFocus={onFocus}
			onBlur={onBlur}
		>
			<button
				type="button"
				aria-label={label}
				aria-pressed={pressed === undefined ? undefined : pressed}
				aria-disabled={comingSoon ? "true" : undefined}
				aria-keyshortcuts={keyShortcuts}
				disabled={inactive}
				onClick={onClick}
				className={`flex h-[38px] w-[38px] items-center justify-center rounded-full transition-colors duration-[var(--duration-ui)] ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent ${tone}`}
			>
				<svg
					viewBox={ICON_VIEWBOX}
					width="22"
					height="22"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					{children}
				</svg>
			</button>
			{visible && (
				<span
					ref={tipRef}
					aria-hidden="true"
					data-tooltip
					className={`pointer-events-none absolute left-1/2 z-50 whitespace-nowrap rounded-full bg-[var(--color-glass-solid)] px-2.5 py-1 text-xs text-[var(--color-fg-alt)] ${place.above ? "bottom-full mb-3" : "top-full mt-3"}`}
					style={{ transform: `translateX(calc(-50% + ${place.dx}px))` }}
				>
					{label}
					{detail && (
						<span className="ml-2 text-[var(--color-fg-muted)]">{detail}</span>
					)}
				</span>
			)}
		</span>
	);
}
