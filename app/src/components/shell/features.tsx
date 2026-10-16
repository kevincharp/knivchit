import type { ComponentType, ReactNode } from "react";
import { PageAbout } from "./PageAbout";
import { PageCapture } from "./PageCapture";
import { PageHome } from "./PageHome";
import { PageSettings } from "./PageSettings";
import type { CapturePermission } from "./useCapturePermission";

export type FeatureStatus = "disponible" | "pronto";

/** Props comunes de todas las páginas del hub. */
export interface PageProps {
	features: Feature[];
	onNavigate: (id: string) => void;
	onCapture: () => void;
	captureError: string | null;
	/** Hay una captura iniciándose: el botón de capturar queda desactivado hasta que el comando termine. */
	capturing?: boolean;
	/** Permiso de captura de GNOME: estado y cómo pedirlo; sin él, la tarjeta no muestra aviso. */
	permission?: CapturePermission;
}

export interface Feature {
	id: string;
	name: string;
	/** Etiqueta corta bajo el icono de la barra lateral (76 px de ancho). */
	shortName?: string;
	/** Paths SVG sobre rejilla de 24 px; se dibujan con trazo 2. */
	icon: ReactNode;
	status: FeatureStatus;
	description: string;
	group: "main" | "footer";
	/** Las funciones «pronto» no necesitan página: se muestra PageComingSoon. */
	page?: ComponentType<PageProps>;
}

/**
 * Registro único de funciones del hub. Añadir una función = una entrada aquí
 * (y su página si ya existe): la barra lateral, Inicio y PageComingSoon se
 * generan desde esta lista.
 */
export const FEATURES: Feature[] = [
	{
		id: "home",
		name: "Inicio",
		icon: (
			<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1Z" />
		),
		status: "disponible",
		description: "Lo esencial de Knivchit de un vistazo.",
		group: "main",
		page: PageHome,
	},
	{
		id: "capture",
		name: "Captura",
		icon: (
			<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M9 12h6M12 9v6" />
		),
		status: "disponible",
		description:
			"Elige una zona de la pantalla, anótala y guárdala, cópiala o fíjala.",
		group: "main",
		page: PageCapture,
	},
	{
		id: "text",
		name: "Texto en pantalla",
		shortName: "Texto",
		icon: <path d="M4 7V5h16v2M12 5v14M9 19h6" />,
		status: "pronto",
		description:
			"Extraerá el texto de cualquier zona de la pantalla y lo traducirá, sin salir del escritorio.",
		group: "main",
	},
	{
		id: "clipboard",
		name: "Portapapeles",
		icon: (
			<>
				<rect x="6" y="5" width="12" height="15" rx="2" />
				<path d="M9 5V4h6v1M9.5 10h5M9.5 14h5" />
			</>
		),
		status: "pronto",
		description:
			"Guardará lo que copias para volver a pegarlo, con búsqueda y elementos fijados. Todo se queda en tu equipo.",
		group: "main",
	},
	{
		id: "emoji",
		name: "Emojis y stickers",
		shortName: "Emojis",
		icon: (
			<path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9 10v.5M15 10v.5M8.5 14c.8 1.4 2 2 3.5 2s2.7-.6 3.5-2" />
		),
		status: "pronto",
		description:
			"Un selector rápido de emojis y stickers para pegar en cualquier aplicación.",
		group: "main",
	},
	{
		id: "settings",
		name: "Configuración",
		shortName: "Ajustes",
		icon: <path d="M5 7h9M18 7h1M5 17h1M10 17h9M16 5v4M8 15v4" />,
		status: "disponible",
		description: "Carpeta de guardado, arranque con la sesión y apariencia.",
		group: "footer",
		page: PageSettings,
	},
	{
		id: "about",
		name: "Acerca de",
		icon: <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 11v5M12 8v.5" />,
		status: "disponible",
		description: "Versión, licencias y actualizaciones.",
		group: "footer",
		page: PageAbout,
	},
];

export function sidebarLabel(feature: Feature): string {
	return feature.shortName ?? feature.name;
}
