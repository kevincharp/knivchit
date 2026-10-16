import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CaptureOverlay } from "./components/capture/CaptureOverlay";
import { DiagOverlay } from "./components/capture/diag/DiagOverlay";
import { readDiagVariant } from "./components/capture/diag/diagVariant";
import { PinWindow } from "./components/capture/PinWindow";
import { initTheme, shouldApplyTheme } from "./lib/theme";

// Tauri abre la ventana overlay apuntando a este mismo bundle con
// ?window=capture-overlay o ?window=pin — una sola SPA, tres árboles de componentes según
// qué ventana la está cargando (ver commands/capture_flow.rs).
const windowKind = new URLSearchParams(window.location.search).get("window");
if (shouldApplyTheme(window.location.search)) initTheme();
// Solo diagnóstico: ?window=capture-overlay&diag=1..5 monta una variante mínima
// del overlay (ver capture/diag). Sin diag, o diag=0, es el overlay real.
const diagVariant = readDiagVariant(window.location.search);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
	<React.StrictMode>
		{windowKind === "capture-overlay" ? (
			diagVariant ? (
				<DiagOverlay variant={diagVariant} />
			) : (
				<CaptureOverlay />
			)
		) : windowKind === "pin" ? (
			<PinWindow />
		) : (
			<App />
		)}
	</React.StrictMode>,
);
