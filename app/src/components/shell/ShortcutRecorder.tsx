import { useEffect, useRef, useState } from "react";
import { acceleratorLabel } from "../../lib/shortcut";
import type { RecordResult } from "../../lib/tauri";
import { Button } from "./Button";

interface ShortcutRecorderProps {
	/** Graba una combinación con la extensión (grab modal del Shell). */
	record: () => Promise<RecordResult>;
	/** Primer intento alternativo (p. ej. la sugerencia ya elegida); los reintentos usan `record`. */
	first?: () => Promise<RecordResult>;
	/** Conflictos del acelerador (vacío = libre); lanza si no se pudo comprobar. */
	check: (accel: string) => Promise<string[]>;
	onAccept: (accel: string) => void;
	onCancel: () => void;
}

type Phase =
	| { kind: "recording" }
	| { kind: "checking"; accel: string }
	| { kind: "conflict"; accel: string; conflicts: string[] }
	| { kind: "retry"; note: string };

const RETRY_NOTES = {
	timeout: "Se agotó el tiempo. Vuelve a intentarlo.",
	busy: "Espera un momento y reintenta.",
	invalid: "Esa combinación no es válida.",
	unavailable:
		"Ahora mismo GNOME no permite capturar el teclado; cierra el diálogo que esté abierto e inténtalo de nuevo.",
} as const;

/**
 * Asignar un atajo. La grabación la hace la extensión con un grab modal: la
 * ventana no recibe las teclas (WebKitGTK no refleja Super y Mutter se queda
 * con las combinaciones ya ligadas), y el modal se traga el ratón, así que
 * mientras graba no hay botón de cancelar: Esc o un clic cancelan en la
 * extensión. El resultado pasa por la comprobación de conflictos y, si los hay,
 * pide confirmación. Un contador de intentos descarta las respuestas de
 * grabaciones ya canceladas, repetidas o de un componente desmontado.
 */
export function ShortcutRecorder({
	record,
	first,
	check,
	onAccept,
	onCancel,
}: ShortcutRecorderProps) {
	const [phase, setPhase] = useState<Phase>({ kind: "recording" });
	const attempt = useRef(0);
	const ref = useRef<HTMLFieldSetElement>(null);

	function fail(e: unknown) {
		setPhase({
			kind: "retry",
			note: e instanceof Error ? e.message : String(e),
		});
	}

	async function evaluate(accel: string, mine: number) {
		setPhase({ kind: "checking", accel });
		try {
			const conflicts = await check(accel);
			if (mine !== attempt.current) return;
			if (conflicts.length) setPhase({ kind: "conflict", accel, conflicts });
			else onAccept(accel);
		} catch (e) {
			if (mine !== attempt.current) return;
			fail(e);
		}
	}

	async function start(source: () => Promise<RecordResult>) {
		const mine = ++attempt.current;
		setPhase({ kind: "recording" });
		try {
			const r = await source();
			if (mine !== attempt.current) return;
			if (r.status === "ok" && r.accel) await evaluate(r.accel, mine);
			else if (r.status === "cancelled") onCancel();
			else
				setPhase({
					kind: "retry",
					note:
						(r.status === "invalid" || r.status === "unavailable") && r.message
							? r.message
							: RETRY_NOTES[r.status === "ok" ? "invalid" : r.status],
				});
		} catch (e) {
			if (mine !== attempt.current) return;
			fail(e);
		}
	}

	function cancel() {
		attempt.current++;
		onCancel();
	}

	// Un microtask cancelable en vez de arrancar en el efecto: StrictMode monta,
	// desmonta y vuelve a montar, y así solo la última montura llama a la extensión.
	// biome-ignore lint/correctness/useExhaustiveDependencies: arranca una vez por montaje
	useEffect(() => {
		let live = true;
		queueMicrotask(() => {
			if (live) start(first ?? record);
		});
		ref.current?.focus();
		return () => {
			live = false;
			attempt.current++;
		};
	}, []);

	return (
		<fieldset
			ref={ref}
			tabIndex={-1}
			aria-label="Asignar atajo"
			onKeyDown={(e) => {
				if (e.key === "Escape" && phase.kind !== "recording") {
					e.stopPropagation();
					cancel();
				}
			}}
			className="m-0 flex min-w-0 flex-col gap-2 rounded-[var(--radius-ui)] border border-[var(--color-accent)] p-3 outline-none"
		>
			<p aria-live="polite" className="text-[13px] font-medium">
				{phase.kind === "recording" &&
					"Pulsa la combinación; Esc o un clic cancelan."}
				{phase.kind === "checking" &&
					`Comprobando ${acceleratorLabel(phase.accel)}…`}
				{phase.kind === "conflict" && "Esa combinación ya tiene dueño."}
				{phase.kind === "retry" && phase.note}
			</p>

			{phase.kind === "conflict" && (
				<div role="alert" className="flex flex-col gap-2">
					<p className="text-xs text-[var(--color-accent-warm)]">
						{acceleratorLabel(phase.accel)} ya lo usa:{" "}
						{phase.conflicts.join("; ")}.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button onClick={() => onAccept(phase.accel)}>
							Usar de todos modos
						</Button>
						<Button onClick={() => start(record)}>Elegir otro</Button>
					</div>
				</div>
			)}

			{phase.kind === "retry" && (
				<div className="flex flex-wrap gap-2">
					<Button onClick={() => start(record)}>Reintentar</Button>
					<Button onClick={cancel}>Cerrar</Button>
				</div>
			)}

			{phase.kind === "checking" && (
				<div className="flex flex-wrap gap-2">
					<Button onClick={cancel}>Cancelar</Button>
				</div>
			)}
		</fieldset>
	);
}
