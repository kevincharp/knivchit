import { Card } from "./Card";
import type { IntegrationState } from "./useIntegrationStatus";

const COPY: Record<
	IntegrationState,
	{ label: string; detail: string; dot: string }
> = {
	checking: {
		label: "Comprobando…",
		detail: "Mirando si la extensión de GNOME Shell está cargada.",
		dot: "bg-[var(--color-fg-muted)]",
	},
	active: {
		label: "Activo",
		detail: "La extensión de GNOME Shell está cargada.",
		dot: "bg-[var(--color-ok)]",
	},
	inactive: {
		label: "Inactivo",
		detail:
			"La extensión de GNOME Shell aún no está cargada. Cierra sesión y vuelve a entrar para activarla; mientras tanto, usa el botón Capturar.",
		dot: "bg-[var(--color-accent-warm)]",
	},
	unknown: {
		label: "No se pudo comprobar",
		detail: "El atajo global puede no funcionar. El botón Capturar sí.",
		dot: "bg-[var(--color-accent-warm)]",
	},
};

export function IntegrationCard({ state }: { state: IntegrationState }) {
	const c = COPY[state];
	return (
		<Card aria-labelledby="integration-title" className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<h2 id="integration-title" className="text-sm font-semibold">
					Atajo global
				</h2>
				<p className="flex items-center gap-2 text-xs" role="status">
					<span
						aria-hidden="true"
						className={`h-2 w-2 rounded-full ${c.dot}`}
					/>
					{c.label}
				</p>
			</div>
			<p className="text-xs leading-snug text-[var(--color-fg-muted)]">
				{c.detail}
			</p>
		</Card>
	);
}
