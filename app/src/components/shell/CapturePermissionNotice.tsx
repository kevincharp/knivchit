import { useState } from "react";
import { APP_NAME } from "../../lib/appName";
import { Button } from "./Button";
import type { CapturePermission } from "./useCapturePermission";

/** Comando para restablecer un permiso rechazado antes (el identificador de la app, en minúsculas). */
export const RESET_COMMAND = `flatpak permission-reset ${APP_NAME.toLowerCase()}`;

export const PENDING_MESSAGE =
	"GNOME necesita tu permiso para capturar la pantalla. Pulsa “Permitir capturas” y acepta el aviso que aparecerá.";
export const DENIED_MESSAGE =
	"GNOME no dio permiso para capturar la pantalla. Pulsa “Permitir capturas” y acepta el aviso. Si lo rechazaste antes, restablécelo con:";
export const CANCELLED_MESSAGE = "Captura cancelada.";
export const UNAVAILABLE_MESSAGE =
	"No hay un portal de capturas disponible (xdg-desktop-portal). Instálalo e inicia sesión de nuevo.";
export const ERROR_MESSAGE =
	"No se pudo comprobar el permiso de captura. Inténtalo de nuevo.";

/**
 * Aviso del permiso de captura bajo el botón «Capturar». Nunca muestra texto
 * técnico del portal: cada estado tiene su mensaje accionable en español. Sin
 * aviso mientras carga o si el permiso está concedido.
 */
export function CapturePermissionNotice({
	permission,
}: {
	permission: CapturePermission;
}) {
	const { status, requesting, request } = permission;
	const [copied, setCopied] = useState(false);

	if (status === "loading" || status === "granted") return null;

	async function copy() {
		try {
			await navigator.clipboard.writeText(RESET_COMMAND);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	const allow = (
		<Button variant="primary" onClick={request} disabled={requesting}>
			Permitir capturas
		</Button>
	);

	if (status === "cancelled") {
		return (
			<div className="flex flex-col gap-2">
				<p role="status" className="text-sm text-[var(--color-fg-muted)]">
					{CANCELLED_MESSAGE}
				</p>
				{allow}
			</div>
		);
	}

	if (status === "pending") {
		return (
			<div className="flex flex-col gap-2">
				<p role="status" className="text-sm text-[var(--color-fg)]">
					{PENDING_MESSAGE}
				</p>
				{allow}
			</div>
		);
	}

	if (status === "denied") {
		return (
			<div className="flex flex-col gap-2">
				<p role="alert" className="text-sm text-[var(--color-accent-warm)]">
					{DENIED_MESSAGE}
				</p>
				<div className="flex items-center gap-2">
					<pre className="m-0 min-w-0 flex-1 overflow-x-auto rounded-[var(--radius-ui)] border border-[var(--color-card-border)] bg-[var(--color-bg-alt)] px-3 py-2 font-mono text-xs">
						<code>{RESET_COMMAND}</code>
					</pre>
					<Button onClick={copy} aria-label="Copiar el comando">
						{copied ? "Copiado" : "Copiar"}
					</Button>
				</div>
				{allow}
			</div>
		);
	}

	if (status === "unavailable") {
		return (
			<p role="alert" className="text-sm text-[var(--color-accent-warm)]">
				{UNAVAILABLE_MESSAGE}
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<p role="alert" className="text-sm text-[var(--color-accent-warm)]">
				{ERROR_MESSAGE}
			</p>
			{allow}
		</div>
	);
}
