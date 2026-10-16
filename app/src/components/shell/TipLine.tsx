import { FeatureIcon } from "./FeatureIcon";

export const TIPS = [
	"Pulsa V para seleccionar y mover tus anotaciones.",
	"Ctrl + Shift + S guarda la captura en la carpeta que elijas al momento.",
	"Fija una captura en pantalla para tenerla a la vista mientras trabajas.",
	"Ctrl + Z deshace cualquier anotación, incluso un borrado.",
];

/** Un consejo corto; cambia cada día. */
export function TipLine({ day = new Date().getDate() }: { day?: number }) {
	return (
		<p className="flex items-center gap-2 text-sm text-[var(--color-fg-muted)]">
			<span className="text-[var(--color-accent-warm)]">
				<FeatureIcon size={18}>
					<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.4.4.5.8.5 1.1v1h6v-1c0-.3.1-.7.5-1.1A6 6 0 0 0 12 3Z" />
				</FeatureIcon>
			</span>
			<span>
				<span className="sr-only">Consejo: </span>
				{TIPS[day % TIPS.length]}
			</span>
		</p>
	);
}
