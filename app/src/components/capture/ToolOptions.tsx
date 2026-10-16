import {
	ANNOTATION_COLORS,
	STROKE_WIDTHS,
	TEXT_SIZES,
	type Tool,
	toolUsesColor,
	toolUsesWidth,
} from "./annotationPalette";
import type { TextAlign } from "./annotations";

const ALIGNMENTS: { id: TextAlign; label: string; icon: string }[] = [
	{
		id: "left",
		label: "Alinear a la izquierda",
		icon: "M2 3h12M2 6.5h8M2 10h12M2 13.5h8",
	},
	{
		id: "center",
		label: "Alinear al centro",
		icon: "M2 3h12M4 6.5h8M2 10h12M4 13.5h8",
	},
	{
		id: "right",
		label: "Alinear a la derecha",
		icon: "M2 3h12M6 6.5h8M2 10h12M6 13.5h8",
	},
];

interface ToolOptionsProps {
	tool: Tool | null;
	color: string;
	onColorChange: (color: string) => void;
	strokeWidth: number;
	onStrokeWidthChange: (width: number) => void;
	/** Solo texto: tamaño de fuente mostrado (px de imagen); sin él se deriva del grosor. */
	fontSize?: number;
	onFontSizeChange?: (size: number) => void;
	/** Solo texto: alineación mostrada (por defecto, izquierda). */
	textAlign?: TextAlign;
	onTextAlignChange?: (align: TextAlign) => void;
}

/**
 * Color y grosor de la herramienta activa; no se muestra si no usa ninguno. El
 * texto no tiene grosor: su segundo grupo es el tamaño de la fuente, con el
 * valor en px a la vista para que quede claro qué se está cambiando.
 */
export function ToolOptions({
	tool,
	color,
	onColorChange,
	strokeWidth,
	onStrokeWidthChange,
	fontSize,
	onFontSizeChange,
	textAlign = "left",
	onTextAlignChange,
}: ToolOptionsProps) {
	const showColor = toolUsesColor(tool);
	const showWidth = toolUsesWidth(tool);
	if (!showColor && !showWidth) return null;
	const isText = tool === "text";
	const shownFontSize = fontSize ?? strokeWidth * 6;
	const changeFontSize = (px: number) =>
		onFontSizeChange ? onFontSizeChange(px) : onStrokeWidthChange(px / 6);

	return (
		// Sin backdrop-filter: ver la nota en CaptureToolbar.tsx.
		<fieldset
			aria-label="Opciones de la herramienta"
			data-capture-toolbar
			className="m-0 flex items-center gap-2 rounded-[999px] border border-[var(--color-pill-border)] bg-[var(--color-pill)] px-3 py-1.5"
		>
			{showColor && (
				<div
					role="radiogroup"
					aria-label="Color"
					className="flex items-center gap-1"
				>
					{ANNOTATION_COLORS.map((c) => {
						const selected = color === c.id;
						return (
							// biome-ignore lint/a11y/useSemanticElements: radio estilizado como muestra de color
							<button
								key={c.id}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={c.label}
								title={c.label}
								onClick={() => onColorChange(c.id)}
								className={`h-6 w-6 rounded-full border transition-transform duration-[var(--duration-ui)] ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
									selected
										? "scale-110 border-[var(--color-toolbar-icon)]"
										: "border-[var(--color-pill-border)]"
								}`}
								style={{ backgroundColor: `var(${c.token})` }}
							/>
						);
					})}
				</div>
			)}
			{showColor && showWidth && (
				<div
					className="h-4 w-px bg-[var(--color-toolbar-divider)]"
					aria-hidden="true"
				/>
			)}
			{isText && (
				<div
					role="radiogroup"
					aria-label="Tamaño del texto"
					className="flex items-center gap-1"
				>
					{TEXT_SIZES.map((t) => {
						const selected = Math.round(shownFontSize) === t.value;
						return (
							// biome-ignore lint/a11y/useSemanticElements: radio estilizado como muestra de tamaño
							<button
								key={t.value}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={t.label}
								title={`${t.label} (${t.value} px)`}
								onClick={() => changeFontSize(t.value)}
								className={`flex h-7 w-7 items-center justify-center rounded-full font-semibold leading-none text-[var(--color-toolbar-icon)] transition-colors duration-[var(--duration-ui)] ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${
									selected
										? "bg-[var(--color-pill-hover)]"
										: "hover:bg-[var(--color-pill-hover)]"
								}`}
							>
								<span
									aria-hidden="true"
									style={{ fontSize: 8 + Math.log2(t.value / 12) * 4 }}
								>
									A
								</span>
							</button>
						);
					})}
					<output
						aria-label="Tamaño de fuente actual"
						className="min-w-[3.25rem] pl-1 text-xs tabular-nums text-[var(--color-pill-ink)]"
					>
						{Math.round(shownFontSize)} px
					</output>
				</div>
			)}
			{isText && (
				// biome-ignore lint/a11y/useSemanticElements: grupo de botones dentro de la píldora; un fieldset anidado rompe su maquetación
				<div
					role="group"
					aria-label="Alineación del texto"
					className="flex items-center gap-0.5"
				>
					{ALIGNMENTS.map((a) => (
						<button
							key={a.id}
							type="button"
							aria-label={a.label}
							aria-pressed={textAlign === a.id}
							title={a.label}
							onClick={() => onTextAlignChange?.(a.id)}
							className={`flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-toolbar-icon)] transition-colors duration-[var(--duration-ui)] ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${
								textAlign === a.id
									? "bg-[var(--color-pill-hover)]"
									: "hover:bg-[var(--color-pill-hover)]"
							}`}
						>
							<svg
								viewBox="0 0 16 16"
								className="h-4 w-4"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
								aria-hidden="true"
							>
								<path d={a.icon} />
							</svg>
						</button>
					))}
				</div>
			)}
			{showWidth && !isText && (
				<div
					role="radiogroup"
					aria-label="Grosor"
					className="flex items-center gap-1"
				>
					{STROKE_WIDTHS.map((w) => {
						const selected = strokeWidth === w.value;
						return (
							// biome-ignore lint/a11y/useSemanticElements: radio estilizado como muestra de grosor
							<button
								key={w.value}
								type="button"
								role="radio"
								aria-checked={selected}
								aria-label={w.label}
								title={w.label}
								onClick={() => onStrokeWidthChange(w.value)}
								className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-[var(--duration-ui)] ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)] ${
									selected
										? "bg-[var(--color-pill-hover)]"
										: "hover:bg-[var(--color-pill-hover)]"
								}`}
							>
								<span
									className="rounded-full bg-[var(--color-toolbar-icon)]"
									style={{ width: w.value + 4, height: w.value + 4 }}
								/>
							</button>
						);
					})}
				</div>
			)}
		</fieldset>
	);
}
