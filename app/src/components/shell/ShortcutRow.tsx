import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "./Button";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { ShortcutValue } from "./ShortcutValue";
import type { useShortcuts } from "./useShortcuts";

interface ShortcutRowProps {
	name: string;
	action: string;
	accel: string | null;
	sc: ReturnType<typeof useShortcuts>;
	/** Acelerador que ofrece el botón de sugerencia; nunca se aplica solo. */
	suggestion?: { accel: string; label: string };
	children?: ReactNode;
}

/** Una acción con atajo: su valor, Asignar/Quitar contra la extensión y el grabador. */
export function ShortcutRow({
	name,
	action,
	accel,
	sc,
	suggestion,
	children,
}: ShortcutRowProps) {
	const [recording, setRecording] = useState<null | "record" | "suggestion">(
		null,
	);

	async function accept(chosen: string) {
		if (await sc.assign(action, chosen)) setRecording(null);
	}

	return (
		<fieldset
			aria-label={name}
			className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
		>
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
				<div className="flex min-w-[8rem] flex-1 flex-col gap-1">
					<span className="text-[13.5px] font-medium">{name}</span>
					<ShortcutValue accel={accel} />
				</div>
				{sc.extensionActive && !recording && (
					<div className="flex shrink-0 flex-wrap gap-2">
						<Button onClick={() => setRecording("record")}>Asignar…</Button>
						<Button onClick={() => sc.assign(action, null)} disabled={!accel}>
							Quitar
						</Button>
					</div>
				)}
			</div>

			{suggestion && sc.extensionActive && !recording && !accel && (
				<div>
					<Button onClick={() => setRecording("suggestion")}>
						{suggestion.label}
					</Button>
				</div>
			)}

			{sc.extensionActive && recording && (
				<ShortcutRecorder
					record={sc.record}
					first={
						recording === "suggestion" && suggestion
							? () =>
									Promise.resolve({
										accel: suggestion.accel,
										status: "ok" as const,
									})
							: undefined
					}
					check={sc.conflicts}
					onAccept={accept}
					onCancel={() => setRecording(null)}
				/>
			)}
			{children}
		</fieldset>
	);
}
