import { useState } from "react";
import { acceleratorLabel, SUGGESTED_CAPTURE_ACCEL } from "../../lib/shortcut";
import { Button } from "./Button";
import { Card } from "./Card";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { ShortcutValue } from "./ShortcutValue";
import { SoonBadge } from "./SoonBadge";
import { CAPTURE_ACTION, OUTDATED_MESSAGE, useShortcuts } from "./useShortcuts";

const FUTURE = ["Panel de emojis", "Portapapeles"];

/**
 * Atajos globales, uno por acción. Knivchit no fija ninguno: el usuario elige.
 * Las acciones futuras aparecen atenuadas con «Pronto». Sin la extensión no se
 * ofrece grabar y se explica cómo activarla.
 */
export function ShortcutsCard() {
	const sc = useShortcuts();
	const [recording, setRecording] = useState<null | "record" | "suggestion">(
		null,
	);

	async function accept(accel: string) {
		if (await sc.assign(CAPTURE_ACTION, accel)) setRecording(null);
	}

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

			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
					<div className="flex min-w-[8rem] flex-1 flex-col gap-1">
						<span className="text-[13.5px] font-medium">Capturar</span>
						<ShortcutValue accel={sc.capture} />
					</div>
					{sc.extensionActive && !recording && (
						<div className="flex shrink-0 flex-wrap gap-2">
							<Button onClick={() => setRecording("record")}>Asignar…</Button>
							<Button
								onClick={() => sc.assign(CAPTURE_ACTION, null)}
								disabled={!sc.capture}
							>
								Quitar
							</Button>
						</div>
					)}
				</div>

				{sc.extensionActive && !recording && !sc.capture && (
					<div>
						<Button onClick={() => setRecording("suggestion")}>
							Sugerencia: {acceleratorLabel(SUGGESTED_CAPTURE_ACCEL)}
						</Button>
					</div>
				)}

				{sc.extensionActive && recording && (
					<ShortcutRecorder
						record={sc.record}
						first={
							recording === "suggestion"
								? () =>
										Promise.resolve({
											accel: SUGGESTED_CAPTURE_ACCEL,
											status: "ok" as const,
										})
								: undefined
						}
						check={sc.conflicts}
						onAccept={accept}
						onCancel={() => setRecording(null)}
					/>
				)}
				{sc.error && (
					<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
						{sc.error}
					</p>
				)}
			</div>

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
