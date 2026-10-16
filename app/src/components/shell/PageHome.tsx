import { CaptureHero } from "./CaptureHero";
import { FeatureCard } from "./FeatureCard";
import { FirstSteps } from "./FirstSteps";
import type { PageProps } from "./features";
import { IntegrationCard } from "./IntegrationCard";
import { SaveDirCard } from "./SaveDirCard";
import { TipLine } from "./TipLine";
import { useIntegrationStatus } from "./useIntegrationStatus";
import { useSaveDir } from "./useSaveDir";
import { useShortcuts } from "./useShortcuts";

export function PageHome({
	features,
	onNavigate,
	onCapture,
	captureError,
	capturing,
	permission,
}: PageProps) {
	const integration = useIntegrationStatus();
	const saveDir = useSaveDir();
	const shortcuts = useShortcuts();
	const assignShortcut = () => onNavigate("settings");
	const upcoming = features.filter((f) => f.status === "pronto");

	return (
		<div className="flex flex-col gap-3">
			<h1 className="sr-only">Inicio</h1>
			<CaptureHero
				onCapture={onCapture}
				capturing={capturing}
				permission={permission}
				error={captureError}
				shortcut={shortcuts.capture}
				onAssignShortcut={assignShortcut}
			/>

			{saveDir.firstRun && (
				<FirstSteps
					integration={integration}
					onChoose={saveDir.choose}
					onUseDefault={saveDir.useDefault}
					error={saveDir.error}
					shortcut={shortcuts.capture}
					onAssignShortcut={assignShortcut}
				/>
			)}

			<IntegrationCard state={integration} />
			<SaveDirCard dir={saveDir.dir} />

			<TipLine />

			{upcoming.length > 0 && (
				<section aria-labelledby="soon-title" className="flex flex-col gap-3">
					<h2 id="soon-title" className="text-sm font-semibold">
						Próximamente
					</h2>
					<div className="flex flex-col gap-2">
						{upcoming.map((f) => (
							<FeatureCard key={f.id} feature={f} onOpen={onNavigate} />
						))}
					</div>
				</section>
			)}
		</div>
	);
}
