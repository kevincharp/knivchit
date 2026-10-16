import { FeatureIcon } from "./FeatureIcon";
import { type Feature, sidebarLabel } from "./features";
import { SoonBadge } from "./SoonBadge";

interface SidebarItemProps {
	feature: Feature;
	active: boolean;
	onSelect: (id: string) => void;
}

/** Botón de sección: icono de 22 px con etiqueta debajo; activo = fondo acento; «Pronto» bajo la etiqueta. */
export function SidebarItem({ feature, active, onSelect }: SidebarItemProps) {
	const soon = feature.status === "pronto";
	const tone = active
		? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]"
		: soon
			? "text-[var(--color-fg-muted)] opacity-80 hover:bg-[var(--color-card-hover)] hover:opacity-100"
			: "text-[var(--color-fg-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]";
	return (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			title={feature.name}
			onClick={() => onSelect(feature.id)}
			className={`flex w-[78px] flex-col items-center justify-center gap-1 rounded-[var(--radius-ui)] text-[11.5px] leading-none transition-colors duration-[var(--duration-ui)] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] motion-reduce:transition-none ${soon ? "h-[66px]" : "h-[54px]"} ${tone}`}
		>
			<FeatureIcon>{feature.icon}</FeatureIcon>
			<span>{sidebarLabel(feature)}</span>
			{soon && (
				<SoonBadge className={active ? "!bg-black/40 !text-white" : ""} />
			)}
		</button>
	);
}
