import { useLayoutEffect, useRef } from "react";

interface TextEditorFieldProps {
	/** Esquina superior izquierda, en px de pantalla dentro del área de captura. */
	left: number;
	top: number;
	/** Tamaño de fuente en px de pantalla (ya multiplicado por la escala). */
	fontPx: number;
	color: string;
	/** Ancho fijo en px de pantalla si el texto tiene recuadro; sin él, crece con lo escrito. */
	widthPx?: number;
	/** Alineación de las líneas dentro del campo. */
	align?: "left" | "center" | "right";
	initial?: string;
	label: string;
	/**
	 * Qué hace Enter: confirmar (al crear; Mayús+Enter es salto de línea) o
	 * insertar un salto de línea (al editar; Ctrl+Enter confirma). Ctrl+Enter
	 * confirma siempre.
	 */
	enterCommits: boolean;
	/** Cada cambio del contenido: la anotación lo refleja en vivo (recuadro, manijas). */
	onChange?: (value: string) => void;
	/** Confirma: Esc, Ctrl+Enter, Enter (al crear) o salir del campo. */
	onCommit: (value: string) => void;
}

/**
 * Campo de texto sobre la captura, para crear un texto o editar el contenido de
 * uno existente en su sitio (mismo tamaño, color y posición). Salir del campo
 * confirma. Cierra UNA vez:
 * Enter y la pérdida de foco posterior no confirman dos veces.
 */
export function TextEditorField({
	left,
	top,
	fontPx,
	color,
	widthPx,
	align = "left",
	initial = "",
	label,
	enterCommits,
	onChange,
	onCommit,
}: TextEditorFieldProps) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const done = useRef(false);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.setSelectionRange(el.value.length, el.value.length);
	}, []);

	// El alto sigue al contenido, y también al tamaño de fuente y al ancho (que
	// pueden cambiar desde las manijas o las opciones sin escribir nada).
	// biome-ignore lint/correctness/useExhaustiveDependencies: fontPx y widthPx son los disparadores
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [fontPx, widthPx]);

	function finish(action: () => void) {
		if (done.current) return;
		done.current = true;
		action();
	}

	return (
		<textarea
			ref={ref}
			// biome-ignore lint/a11y/noAutofocus: el campo nace de un clic, doble clic o Enter explícito del usuario
			autoFocus
			aria-label={label}
			rows={1}
			wrap={widthPx ? "soft" : "off"}
			defaultValue={initial}
			className={`absolute resize-none overflow-hidden border border-transparent bg-transparent p-0 font-semibold leading-[1.2] outline-none ${
				widthPx ? "whitespace-pre-wrap" : "whitespace-pre"
			}`}
			style={{
				// Caja de contenido = la del texto: el borde punteado queda FUERA (1 px) y
				// el texto empieza donde lo pinta el canvas y se parte en el mismo ancho.
				boxSizing: "content-box",
				left: left - 1,
				top: top - 1,
				...(widthPx ? { width: widthPx } : { minWidth: "6ch" }),
				textAlign: align,
				overflowWrap: "anywhere",
				color,
				fontSize: fontPx,
				fontFamily: "Inter, system-ui, sans-serif",
			}}
			onInput={(e) => {
				const el = e.currentTarget;
				el.style.height = "auto";
				el.style.height = `${el.scrollHeight}px`;
				onChange?.(el.value);
			}}
			onKeyDown={(e) => {
				e.stopPropagation();
				const value = e.currentTarget.value;
				if (e.key === "Escape") {
					e.preventDefault();
					finish(() => onCommit(value));
				} else if (e.key === "Enter") {
					const mod = e.ctrlKey || e.metaKey;
					if (mod || (enterCommits && !e.shiftKey)) {
						e.preventDefault();
						finish(() => onCommit(value));
					}
				}
			}}
			onBlur={(e) => {
				const value = e.currentTarget.value;
				finish(() => onCommit(value));
			}}
		/>
	);
}
