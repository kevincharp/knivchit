import { useState } from "react";
import { APP_NAME } from "../../lib/appName";
import { quitApp } from "../../lib/tauri";
import { Button } from "./Button";
import { Card } from "./Card";

/**
 * Salir de la aplicación por completo. Cerrar la ventana no termina el proceso
 * (sigue atendiendo el atajo), así que esta es la salida explícita.
 *
 * Sin confirmación: una captura en curso oculta esta ventana, de modo que no se
 * puede pulsar el botón mientras dura; y el backend descarta lo pendiente al salir.
 */
export function QuitCard() {
	const [error, setError] = useState<string | null>(null);
	const [quitting, setQuitting] = useState(false);

	async function quit() {
		if (quitting) return;
		setQuitting(true);
		setError(null);
		try {
			await quitApp();
		} catch (e) {
			setError(`No se pudo salir: ${String(e)}`);
			setQuitting(false);
		}
	}

	return (
		<Card aria-labelledby="quit-title" className="flex flex-col gap-2">
			<h2 id="quit-title" className="text-sm font-semibold">
				Sesión
			</h2>
			<p className="text-xs text-[var(--color-fg-muted)]">
				Cerrar la ventana deja {APP_NAME} activo para atender el atajo. Salir lo
				cierra por completo.
			</p>
			<div>
				<Button
					onClick={quit}
					disabled={quitting}
					className="text-[var(--color-accent-warm)]"
				>
					Salir de {APP_NAME}
				</Button>
			</div>
			{error && (
				<p role="alert" className="text-xs text-[var(--color-accent-warm)]">
					{error}
				</p>
			)}
		</Card>
	);
}
