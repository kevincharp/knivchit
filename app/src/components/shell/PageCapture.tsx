import type { Tool } from "../capture/annotationPalette";
import { TOOL_ICONS, type ToolIconName } from "../capture/toolbarIcons";
import { TOOL_BINDINGS, toolShortcutLabel } from "../capture/toolShortcuts";
import { Button } from "./Button";
import { CapturePermissionNotice } from "./CapturePermissionNotice";
import { Card } from "./Card";
import { FeatureIcon } from "./FeatureIcon";
import type { PageProps } from "./features";
import { ShortcutChip } from "./ShortcutChip";
import { ShortcutValue } from "./ShortcutValue";
import { useShortcuts } from "./useShortcuts";

const TOOL_INFO: Record<string, { icon: ToolIconName; hint: string }> = {
	select: { icon: "select", hint: "Mueve y edita lo ya dibujado" },
	rect: { icon: "rect", hint: "Marca una zona" },
	ellipse: { icon: "ellipse", hint: "Rodea algo" },
	arrow: { icon: "arrow", hint: "Señala" },
	pen: { icon: "pen", hint: "Dibuja a mano" },
	text: { icon: "text", hint: "Escribe sobre la imagen" },
	mosaic: { icon: "mosaic", hint: "Oculta datos sensibles" },
	eraser: { icon: "eraser", hint: "Quita una anotación" },
};

const SHORTCUTS: { keys: string[]; action: string }[] = [
	{ keys: ["Ctrl", "C"], action: "Copiar y cerrar" },
	{ keys: ["Ctrl", "S"], action: "Guardar" },
	{ keys: ["Ctrl", "Shift", "S"], action: "Guardar como…" },
	{ keys: ["Ctrl", "Z"], action: "Deshacer" },
	{ keys: ["Supr"], action: "Borrar la anotación elegida" },
	{ keys: ["Esc"], action: "Cancelar" },
	{ keys: ["?"], action: "Ayuda de atajos en el editor" },
];

export function PageCapture({
	onCapture,
	onNavigate,
	captureError,
	capturing,
	permission,
}: PageProps) {
	const shortcuts = useShortcuts();
	return (
		<div className="flex flex-col gap-3">
			<h1 className="text-lg font-semibold">Captura</h1>
			<Button
				variant="primary"
				onClick={onCapture}
				disabled={capturing}
				className="w-full"
			>
				Capturar
			</Button>
			{permission && <CapturePermissionNotice permission={permission} />}
			{captureError && (
				<p role="alert" className="text-sm text-[var(--color-accent-warm)]">
					{captureError}
				</p>
			)}
			<div className="flex items-center justify-center gap-3 text-xs text-[var(--color-fg-muted)]">
				{shortcuts.capture ? (
					<>
						Desde cualquier aplicación
						<ShortcutValue accel={shortcuts.capture} />
					</>
				) : (
					<>
						Atajo: sin asignar
						<Button onClick={() => onNavigate("settings")}>
							Asignar atajo
						</Button>
					</>
				)}
			</div>

			<Card aria-labelledby="tools-title" className="flex flex-col gap-1">
				<h2 id="tools-title" className="text-sm font-semibold">
					Herramientas
				</h2>
				<p className="text-xs text-[var(--color-fg-muted)]">
					Alt+letra cambia de herramienta siempre; la letra sola, fuera del
					texto. Repetirla la apaga.
				</p>
				<ul className="m-0 flex list-none flex-col p-0">
					{TOOL_BINDINGS.map((b) => {
						const info = TOOL_INFO[b.tool as Tool];
						return (
							<li
								key={b.tool}
								className="flex items-center gap-3 border-t border-[var(--color-card-border)] py-2 first:border-t-0"
							>
								<FeatureIcon size={20}>{TOOL_ICONS[info.icon]}</FeatureIcon>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-[13.5px] font-medium">{b.label}</span>
									<span className="text-xs text-[var(--color-fg-muted)]">
										{info.hint}
									</span>
								</span>
								<span className="shrink-0 text-xs text-[var(--color-fg-muted)]">
									{toolShortcutLabel(b.tool)}
								</span>
							</li>
						);
					})}
				</ul>
			</Card>

			<Card aria-labelledby="keys-title" className="flex flex-col gap-2">
				<h2 id="keys-title" className="text-sm font-semibold">
					Atajos
				</h2>
				<dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
					{SHORTCUTS.map((s) => (
						<div key={s.action} className="contents">
							<dt>
								<ShortcutChip keys={s.keys} />
							</dt>
							<dd className="m-0 text-[13px] text-[var(--color-fg-muted)]">
								{s.action}
							</dd>
						</div>
					))}
				</dl>
			</Card>
		</div>
	);
}
