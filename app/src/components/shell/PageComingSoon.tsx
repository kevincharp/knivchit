import { FeatureIcon } from "./FeatureIcon";
import type { Feature } from "./features";
import { SoonBadge } from "./SoonBadge";

/** Página honesta de una función que aún no existe: sin controles falsos. */
export function PageComingSoon({ feature }: { feature: Feature }) {
	return (
		<section
			aria-labelledby="page-title"
			className="flex h-full flex-col items-start justify-center gap-4"
		>
			<div className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-ui)] border border-dashed border-[var(--color-card-border)] text-[var(--color-fg-muted)]">
				<FeatureIcon size={30}>{feature.icon}</FeatureIcon>
			</div>
			<div className="flex items-center gap-3">
				<h1 id="page-title" className="text-xl font-semibold">
					{feature.name}
				</h1>
				<SoonBadge />
			</div>
			<p className="max-w-[46ch] text-[var(--color-fg-muted)]">
				{feature.description}
			</p>
			<p className="max-w-[46ch] text-sm text-[var(--color-fg-muted)]">
				Todavía no está disponible en esta versión de Knivchit.
			</p>
		</section>
	);
}
