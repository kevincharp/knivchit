import { type KeyboardEvent, useRef } from "react";
import type { Tool } from "./annotationPalette";
import { ToolbarButton } from "./ToolbarButton";
import { TOOL_ICONS, type ToolIconName } from "./toolbarIcons";
import { toolAriaKeyShortcuts, toolShortcutLabel } from "./toolShortcuts";

interface CaptureToolbarProps {
	tool: Tool | null;
	onToolChange: (tool: Tool | null) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
	onPin: () => void;
	onSave: () => void;
	onSaveAs: () => void;
	onCancel: () => void;
	onConfirm: () => void;
	busy?: boolean;
}

const DRAWING_TOOLS: { tool: Tool; label: string; icon: ToolIconName }[] = [
	{ tool: "select", label: "Seleccionar", icon: "select" },
	{ tool: "rect", label: "Rectángulo", icon: "rect" },
	{ tool: "ellipse", label: "Elipse", icon: "ellipse" },
	{ tool: "arrow", label: "Flecha", icon: "arrow" },
	{ tool: "pen", label: "Lápiz", icon: "pen" },
	{ tool: "text", label: "Texto", icon: "text" },
	{ tool: "mosaic", label: "Mosaico", icon: "mosaic" },
	{ tool: "eraser", label: "Borrador", icon: "eraser" },
];

function Divider() {
	return (
		<div
			className="mx-1 h-4 w-px bg-[var(--color-pill-divider)]"
			aria-hidden="true"
		/>
	);
}

/**
 * Píldora de herramientas. Cuatro grupos: dibujo · deshacer/rehacer ·
 * acciones inteligentes (próximamente) · salida. Las flechas del teclado
 * mueven el foco entre los botones activos.
 */
export function CaptureToolbar({
	tool,
	onToolChange,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
	onPin,
	onSave,
	onSaveAs,
	onCancel,
	onConfirm,
	busy,
}: CaptureToolbarProps) {
	const ref = useRef<HTMLDivElement>(null);

	function onKeyDown(e: KeyboardEvent) {
		if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
		const buttons = Array.from(
			ref.current?.querySelectorAll<HTMLButtonElement>(
				"button:not(:disabled)",
			) ?? [],
		);
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
		if (at === -1) return;
		e.preventDefault();
		const next =
			(at + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
			buttons.length;
		buttons[next].focus();
	}

	return (
		// Sin backdrop-filter: la píldora se reposiciona en cada frame mientras
		// se arrastra una manija, y el blur es caro en WebKitGTK. --color-pill ya
		// es casi opaca (94%), así que no se nota a simple vista.
		<div
			ref={ref}
			role="toolbar"
			aria-label="Herramientas de captura"
			data-capture-toolbar
			onKeyDown={onKeyDown}
			className="flex items-center gap-1 rounded-[999px] border border-[var(--color-pill-border)] bg-[var(--color-pill)] px-3 py-2"
		>
			{DRAWING_TOOLS.map((t) => (
				<ToolbarButton
					key={t.tool}
					label={t.label}
					pressed={tool === t.tool}
					shortcut={toolShortcutLabel(t.tool)}
					keyShortcuts={toolAriaKeyShortcuts(t.tool)}
					onClick={() => onToolChange(tool === t.tool ? null : t.tool)}
				>
					{TOOL_ICONS[t.icon]}
				</ToolbarButton>
			))}

			<Divider />

			<ToolbarButton
				label="Deshacer"
				disabled={!canUndo}
				onClick={onUndo}
				shortcut="Ctrl+Z"
				keyShortcuts="Control+Z"
			>
				{TOOL_ICONS.undo}
			</ToolbarButton>
			<ToolbarButton
				label="Rehacer"
				disabled={!canRedo}
				onClick={onRedo}
				shortcut="Ctrl+Shift+Z"
				keyShortcuts="Control+Shift+Z"
			>
				{TOOL_ICONS.redo}
			</ToolbarButton>

			<Divider />

			<ToolbarButton label="Extraer texto (OCR)" comingSoon>
				{TOOL_ICONS.ocr}
			</ToolbarButton>
			<ToolbarButton label="Traducir" comingSoon>
				{TOOL_ICONS.translate}
			</ToolbarButton>
			<ToolbarButton label="Leer código QR" comingSoon>
				{TOOL_ICONS.qr}
			</ToolbarButton>

			<Divider />

			<ToolbarButton label="Fijar en pantalla" disabled={busy} onClick={onPin}>
				{TOOL_ICONS.pin}
			</ToolbarButton>
			<ToolbarButton
				label="Guardar"
				disabled={busy}
				onClick={onSave}
				shortcut="Ctrl+S"
				keyShortcuts="Control+S"
			>
				{TOOL_ICONS.save}
			</ToolbarButton>
			<ToolbarButton
				label="Guardar como…"
				disabled={busy}
				onClick={onSaveAs}
				shortcut="Ctrl+Shift+S"
				keyShortcuts="Control+Shift+S"
			>
				{TOOL_ICONS.saveAs}
			</ToolbarButton>
			<ToolbarButton
				label="Cancelar"
				onClick={onCancel}
				shortcut="Esc"
				keyShortcuts="Escape"
			>
				{TOOL_ICONS.cancel}
			</ToolbarButton>
			<ToolbarButton
				label="Copiar y cerrar"
				primary
				disabled={busy}
				onClick={onConfirm}
				shortcut="Enter · Ctrl+C"
				keyShortcuts="Enter Control+C"
			>
				{TOOL_ICONS.confirm}
			</ToolbarButton>
		</div>
	);
}
