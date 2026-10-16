import { Button } from "./Button";
import { Card } from "./Card";
import { ShortcutValue } from "./ShortcutValue";
import type { IntegrationState } from "./useIntegrationStatus";

function Mark({ done }: { done: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
				done
					? "border-[var(--color-ok)] text-[var(--color-ok)]"
					: "border-[var(--color-card-border)] text-[var(--color-fg-muted)]"
			}`}
		>
			{done ? "✓" : ""}
		</span>
	);
}

interface FirstStepsProps {
	integration: IntegrationState;
	onChoose: () => void;
	onUseDefault: () => void;
	error: string | null;
	shortcut: string | null;
	onAssignShortcut: () => void;
}

/** Lista de primer uso: sustituye a la pantalla de bienvenida aparte. Es una secuencia real, por eso va numerada. */
export function FirstSteps({
	integration,
	onChoose,
	onUseDefault,
	error,
	shortcut,
	onAssignShortcut,
}: FirstStepsProps) {
	return (
		<Card aria-labelledby="steps-title" className="flex flex-col gap-3">
			<h2 id="steps-title" className="text-sm font-semibold">
				Para empezar
			</h2>
			<ol className="m-0 flex list-none flex-col gap-3 p-0 text-sm">
				<li className="flex gap-3">
					<Mark done={integration === "active"} />
					<span>
						Activa la extensión de GNOME Shell
						<span className="block text-xs text-[var(--color-fg-muted)]">
							{integration === "active"
								? "Ya está activa."
								: "Cierra sesión y vuelve a entrar. Sin ella la app funciona, pero sin atajo global."}
						</span>
					</span>
				</li>
				<li className="flex gap-3">
					<Mark done={shortcut !== null} />
					<span className="flex flex-col gap-2">
						Elige tu atajo
						{shortcut ? (
							<ShortcutValue accel={shortcut} />
						) : (
							<span className="flex items-center gap-3">
								<span className="text-xs text-[var(--color-fg-muted)]">
									Knivchit no trae ninguno: tú decides.
								</span>
								<Button onClick={onAssignShortcut}>Asignar atajo</Button>
							</span>
						)}
					</span>
				</li>
				<li className="flex gap-3">
					<Mark done={false} />
					<span className="flex flex-col gap-2">
						Elige dónde guardar tus capturas
						<span className="flex gap-2">
							<Button onClick={onChoose}>Elegir carpeta…</Button>
							<Button onClick={onUseDefault}>Usar la predeterminada</Button>
						</span>
					</span>
				</li>
			</ol>
			{error && (
				<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
					{error}
				</p>
			)}
		</Card>
	);
}
