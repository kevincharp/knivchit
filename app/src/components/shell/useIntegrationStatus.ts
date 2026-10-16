import { useEffect, useState } from "react";
import { getIntegrationStatus } from "../../lib/tauri";

export type IntegrationState = "checking" | "active" | "inactive" | "unknown";

/** Estado del atajo global (extensión de GNOME Shell). `unknown` si no se pudo consultar. */
export function useIntegrationStatus(): IntegrationState {
	const [state, setState] = useState<IntegrationState>("checking");
	useEffect(() => {
		let alive = true;
		getIntegrationStatus()
			.then(
				(s) => alive && setState(s.extension_active ? "active" : "inactive"),
			)
			.catch(() => alive && setState("unknown"));
		return () => {
			alive = false;
		};
	}, []);
	return state;
}
