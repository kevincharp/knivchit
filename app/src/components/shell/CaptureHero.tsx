import { Button } from "./Button";
import { CapturePermissionNotice } from "./CapturePermissionNotice";
import { ShortcutValue } from "./ShortcutValue";
import type { CapturePermission } from "./useCapturePermission";

const CORNER = "absolute h-3.5 w-3.5 border-[var(--color-accent)]";

/**
 * Tarjeta del capturador. Las cuatro esquinas de visor en acento son el sello
 * de Knivchit; la maqueta de arriba repite el marco redondeado, la etiqueta de
 * dimensiones y la flecha del overlay real.
 */
export function CaptureHero({
	onCapture,
	capturing = false,
	permission,
	error,
	shortcut,
	onAssignShortcut,
}: {
	onCapture: () => void;
	/** Captura iniciándose: el botón no admite otra pulsación. */
	capturing?: boolean;
	/** Permiso de captura de GNOME; sin él no se muestra aviso. */
	permission?: CapturePermission;
	error: string | null;
	/** Atajo global asignado (acelerador GTK) o nada. */
	shortcut: string | null;
	onAssignShortcut: () => void;
}) {
	return (
		<section
			aria-labelledby="hero-title"
			className="relative overflow-hidden rounded-[var(--radius-ui)] border border-[var(--color-card-border)] bg-[var(--color-card)]"
		>
			<span
				aria-hidden="true"
				className={`${CORNER} top-2 left-2 border-t-2 border-l-2`}
			/>
			<span
				aria-hidden="true"
				className={`${CORNER} top-2 right-2 border-t-2 border-r-2`}
			/>
			<span
				aria-hidden="true"
				className={`${CORNER} bottom-2 left-2 border-b-2 border-l-2`}
			/>
			<span
				aria-hidden="true"
				className={`${CORNER} right-2 bottom-2 border-r-2 border-b-2`}
			/>

			<div
				aria-hidden="true"
				className="relative mx-6 mt-6 h-[116px] overflow-hidden rounded-[10px] bg-[var(--color-shot)]"
			>
				<span className="absolute top-2.5 left-3 h-[5px] w-[90px] rounded-[3px] bg-[var(--color-card-border)]" />
				<span className="absolute bottom-2.5 left-3 h-[5px] w-[120px] rounded-[3px] bg-[var(--color-card-border)]" />
				<span className="absolute top-[7px] left-[52px] rounded-full bg-[var(--color-glass-solid)] px-2 font-mono text-[10px] leading-4 text-[var(--color-fg-alt)]">
					1280 × 720
				</span>
				<div className="absolute top-5 left-11 h-[74px] w-[150px] rounded-[var(--radius-capture)] border-2 border-[var(--color-accent)] bg-[var(--color-selection-fill)]">
					{[
						"-top-[5px] -left-[5px]",
						"-top-[5px] -right-[5px]",
						"-bottom-[5px] -left-[5px]",
						"-right-[5px] -bottom-[5px]",
					].map((pos) => (
						<i
							key={pos}
							className={`absolute ${pos} h-[9px] w-[9px] rounded-[2px] border border-[var(--color-bg)] bg-[var(--color-accent)]`}
						/>
					))}
					<svg
						aria-hidden="true"
						viewBox="0 0 56 34"
						className="absolute top-[22px] left-10 h-[34px] w-[56px]"
						fill="none"
						stroke="var(--color-ann-red)"
						strokeWidth="3"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M4 30 46 6M30 5l17 1-6 15" />
					</svg>
				</div>
			</div>

			<div className="flex flex-col gap-2.5 px-6 pt-4 pb-6">
				<h2 id="hero-title" className="text-[17px] font-semibold">
					Captura de pantalla
				</h2>
				<p className="text-[13px] text-[var(--color-fg-muted)]">
					Elige una zona, anótala y cópiala o guárdala en un clic.
				</p>
				<Button
					variant="primary"
					onClick={onCapture}
					disabled={capturing}
					className="w-full"
				>
					Capturar
				</Button>
				{permission && <CapturePermissionNotice permission={permission} />}
				<div className="flex items-center justify-center gap-3">
					{shortcut ? (
						<ShortcutValue accel={shortcut} />
					) : (
						<>
							<span className="text-xs text-[var(--color-fg-muted)]">
								Atajo: sin asignar
							</span>
							<Button onClick={onAssignShortcut}>Asignar atajo</Button>
						</>
					)}
				</div>
				{error && (
					<p role="alert" className="text-sm text-[var(--color-accent-warm)]">
						{error}
					</p>
				)}
			</div>
		</section>
	);
}
