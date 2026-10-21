import { acceleratorLabel, SUGGESTED_CAPTURE_ACCEL } from "../../lib/shortcut";
import { openPicker } from "../../lib/tauri";
import { Button } from "./Button";
import { Card } from "./Card";
import { ShortcutRow } from "./ShortcutRow";
import { SoonBadge } from "./SoonBadge";
import {
	CAPTURE_ACTION,
	EMOJI_ACTION,
	OUTDATED_MESSAGE,
	useShortcuts,
} from "./useShortcuts";

const FUTURE = ["Portapapeles"];

/**
 * Atajos globales, uno por acción. Knivchit no fija ninguno: el usuario elige.
 * Las acciones futuras aparecen atenuadas con «Pronto». Sin la extensión no se
 * ofrece grabar y se explica cómo activarla.
 */
export function ShortcutsCard() {
	const sc = useShortcuts();
	return (
		<Card aria-labelledby="shortcuts-title" className="flex flex-col gap-3">
			<h2 id="shortcuts-title" className="text-sm font-semibold">
				Atajos
			</h2>

			{sc.status === "ready" && !sc.extensionActive && (
				<p className="text-xs leading-snug text-[var(--color-fg-muted)]">
					Los atajos los gestiona la extensión de GNOME Shell, que aún no está
					activa. Cierra sesión y vuelve a entrar para activarla; mientras
					tanto, el botón Capturar funciona igual.
				</p>
			)}
			{sc.status === "outdated" && (
				<p
					role="alert"
					className="text-xs leading-snug text-[var(--color-accent-warm)]"
				>
					{OUTDATED_MESSAGE}
				</p>
			)}
			{sc.status === "unavailable" && (
				<p className="text-xs leading-snug text-[var(--color-fg-muted)]">
					No se pudieron leer los atajos. El botón Capturar sigue funcionando.
				</p>
			)}

			<ShortcutRow
				name="Capturar"
				action={CAPTURE_ACTION}
				accel={sc.capture}
				sc={sc}
				suggestion={{
					accel: SUGGESTED_CAPTURE_ACCEL,
					label: `Sugerencia: ${acceleratorLabel(SUGGESTED_CAPTURE_ACCEL)}`,
				}}
			/>
			<ShortcutRow
				name="Panel de emojis"
				action={EMOJI_ACTION}
				accel={sc.emoji}
				sc={sc}
			>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span className="text-xs text-[var(--color-fg-muted)]">
						Sugerencia: Super + .
					</span>
					<Button onClick={() => openPicker("emoji")}>Abrir</Button>
				</div>
			</ShortcutRow>
			{sc.error && (
				<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
					{sc.error}
				</p>
			)}

			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{FUTURE.map((name) => (
					<li
						key={name}
						aria-disabled="true"
						className="flex items-center justify-between gap-3 border-t border-[var(--color-card-border)] pt-2 text-[var(--color-fg-muted)] opacity-70"
					>
						<span className="text-[13.5px]">{name}</span>
						<SoonBadge />
					</li>
				))}
			</ul>
		</Card>
	);
}
