import { FeatureIcon } from "./FeatureIcon";
import type { Feature } from "./features";
import { SoonBadge } from "./SoonBadge";

/** Fila atenuada de una función futura en Inicio; abre su página honesta. */
export function FeatureCard({
	feature,
	onOpen,
}: {
	feature: Feature;
	onOpen: (id: string) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onOpen(feature.id)}
			className="flex w-full items-start gap-3 rounded-[var(--radius-ui)] border border-dashed border-[var(--color-card-border)] p-3 text-left text-[var(--color-fg-muted)] transition-colors duration-[var(--duration-ui)] ease-out hover:bg-[var(--color-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none"
		>
			<span className="mt-px shrink-0">
				<FeatureIcon>{feature.icon}</FeatureIcon>
			</span>
			<span className="flex flex-col gap-1">
				<span className="flex items-center gap-2 text-[13.5px] font-medium text-[var(--color-fg)]">
					{feature.name}
					<SoonBadge />
				</span>
				<span className="text-xs leading-snug">{feature.description}</span>
			</span>
		</button>
	);
}
