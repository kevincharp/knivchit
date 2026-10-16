import { useEffect, useRef, useState } from "react";
import { startCapture } from "../../lib/tauri";
import { TitleBar } from "../TitleBar";
import { FEATURES, type Feature } from "./features";
import { PageComingSoon } from "./PageComingSoon";
import { Sidebar } from "./Sidebar";
import { useCapturePermission } from "./useCapturePermission";

/**
 * Ventana principal: barra de título propia sobre el color del marco y,
 * debajo, un panel inset redondeado con la barra lateral y la página activa.
 * La navegación es estado local; las páginas salen del registro de funciones.
 */
/** Fallo al iniciar la captura que no es de permiso: sin detalles técnicos. */
export const CAPTURE_FAILED_MESSAGE =
	"No se pudo iniciar la captura. Inténtalo de nuevo.";

export function AppShell({ features = FEATURES }: { features?: Feature[] }) {
	const [current, setCurrent] = useState(features[0]?.id ?? "");
	const [captureError, setCaptureError] = useState<string | null>(null);
	const mainRef = useRef<HTMLElement>(null);
	const navigated = useRef(false);
	// Captura iniciándose: el ref bloquea la reentrada en el mismo instante (un
	// doble clic, o Enter/Espacio mantenidos con el foco en el botón, llegan antes
	// de que React repinte el botón desactivado); el estado lo desactiva a la vista.
	const starting = useRef(false);
	const [capturing, setCapturing] = useState(false);
	const permission = useCapturePermission();

	const feature = features.find((f) => f.id === current) ?? features[0];
	const Page = feature?.status === "disponible" ? feature.page : undefined;

	// Tras navegar, el foco pasa al contenido (no en el primer render).
	// biome-ignore lint/correctness/useExhaustiveDependencies: solo reacciona a la sección activa
	useEffect(() => {
		if (!navigated.current) {
			navigated.current = true;
			return;
		}
		mainRef.current?.focus();
	}, [current]);

	async function capture() {
		if (starting.current) return;
		starting.current = true;
		setCapturing(true);
		setCaptureError(null);
		try {
			await startCapture();
		} catch (e) {
			// Un fallo de permiso se explica en el aviso del permiso; cualquier otro se
			// cuenta sin el texto técnico del portal.
			if (!permission.report(e)) setCaptureError(CAPTURE_FAILED_MESSAGE);
		} finally {
			starting.current = false;
			setCapturing(false);
		}
	}

	return (
		<div className="flex h-screen flex-col bg-[var(--color-chrome)] text-[var(--color-fg)]">
			<TitleBar />
			<div className="mx-2 mb-2 flex min-h-0 flex-1 overflow-hidden rounded-[var(--radius-ui)] border border-[var(--color-card-border)] bg-[var(--color-bg)]">
				<Sidebar
					features={features}
					current={feature?.id ?? ""}
					onSelect={setCurrent}
				/>
				<main
					ref={mainRef}
					tabIndex={-1}
					className="min-w-0 flex-1 overflow-y-auto p-3 outline-none"
				>
					{feature &&
						(Page ? (
							<Page
								features={features}
								onNavigate={setCurrent}
								onCapture={capture}
								captureError={captureError}
								capturing={capturing}
								permission={permission}
							/>
						) : (
							<PageComingSoon feature={feature} />
						))}
				</main>
			</div>
		</div>
	);
}
