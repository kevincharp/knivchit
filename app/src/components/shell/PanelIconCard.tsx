import { APP_NAME } from "../../lib/appName";
import { Card } from "./Card";
import { Switch } from "./Switch";
import { usePanelIcon } from "./usePanelIcon";

/** Ajuste del icono opcional de la barra superior de GNOME Shell. */
export function PanelIconCard() {
	const icon = usePanelIcon();
	return (
		<Card className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 id="panel-icon-title" className="text-sm font-semibold">
						Mostrar icono en la barra superior
					</h2>
					<p className="text-xs text-[var(--color-fg-muted)]">
						Un clic en el icono abre esta ventana. Si lo desactivas, abre{" "}
						{APP_NAME} desde el menú de aplicaciones.
					</p>
				</div>
				<Switch
					checked={icon.enabled}
					onChange={icon.change}
					labelledBy="panel-icon-title"
					disabled={icon.status !== "ready"}
				/>
			</div>
			{icon.error && (
				<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
					{icon.error}
				</p>
			)}
		</Card>
	);
}
