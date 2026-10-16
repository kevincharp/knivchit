import { useEffect, useState } from "react";
import { checkForUpdate, getAppVersion } from "../../lib/tauri";
import { Button } from "./Button";
import { Card } from "./Card";
import { LogoMarkLarge } from "./LogoMarkLarge";
import { SoonBadge } from "./SoonBadge";

export function PageAbout() {
	const [version, setVersion] = useState<string | null>(null);
	const [checking, setChecking] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let alive = true;
		getAppVersion()
			.then((v) => alive && setVersion(v))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	async function check() {
		setChecking(true);
		setMessage(null);
		setFailed(false);
		try {
			const info = await checkForUpdate();
			setMessage(
				info.has_update
					? `Hay una versión nueva: ${info.latest_version}.`
					: `Estás al día: tienes la versión ${version ?? info.latest_version}.`,
			);
		} catch {
			setFailed(true);
			setMessage(
				"No se pudo comprobar. Revisa tu conexión e inténtalo de nuevo.",
			);
		} finally {
			setChecking(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<h1 className="sr-only">Acerca de</h1>

			<Card className="flex items-center gap-4 py-5">
				<LogoMarkLarge />
				<div>
					<p className="text-xl font-semibold">Knivchit</p>
					<p className="text-xs text-[var(--color-fg-muted)]">
						{version ? `Versión ${version}` : "Versión…"}
					</p>
				</div>
			</Card>

			<Card aria-labelledby="license-title" className="flex flex-col gap-2">
				<h2 id="license-title" className="text-sm font-semibold">
					Licencias
				</h2>
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
					<dt className="text-[var(--color-fg-muted)]">Aplicación</dt>
					<dd className="m-0 text-right">MIT</dd>
					<dt className="text-[var(--color-fg-muted)]">Extensión de GNOME</dt>
					<dd className="m-0 text-right">GPL-3.0</dd>
				</dl>
			</Card>

			<Card aria-labelledby="update-title" className="flex flex-col gap-2">
				<h2 id="update-title" className="text-sm font-semibold">
					Actualizaciones
				</h2>
				<div>
					<Button onClick={check} disabled={checking}>
						{checking ? "Buscando…" : "Buscar actualizaciones"}
					</Button>
				</div>
				<p
					role="status"
					className={`min-h-[18px] text-xs ${failed ? "text-[var(--color-accent-warm)]" : "text-[var(--color-fg-muted)]"}`}
				>
					{message}
				</p>
			</Card>

			<Card className="flex flex-col gap-1">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold">Repositorio público</h2>
					<SoonBadge />
				</div>
				<p className="text-xs text-[var(--color-fg-muted)]">
					El código se publicará en una versión próxima.
				</p>
			</Card>
		</div>
	);
}
