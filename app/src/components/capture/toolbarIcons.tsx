import type { ReactNode } from "react";

/**
 * Glifos de la píldora sobre una rejilla de 24 px, dibujados para ocupar la
 * misma caja óptica (de 4 a 20). Rectángulo y elipse son cuadrado y círculo
 * perfectos: solo es el icono, la herramienta dibuja formas libres.
 */
export const ICON_VIEWBOX = "0 0 24 24";

export const TOOL_ICONS = {
	select: <path d="M6 4l12 7-5.5 1.5L10 18Z" />,
	rect: <rect x="4" y="4" width="16" height="16" rx="2.5" />,
	ellipse: <circle cx="12" cy="12" r="8" />,
	arrow: (
		<>
			<path d="M6 18 18 6" />
			<path d="M9 6h9v9" />
		</>
	),
	pen: <path d="M4 17c3-10 5-12 7-8s3 8 5 6 3-6 4-8" />,
	text: (
		<>
			<rect x="4" y="4" width="16" height="16" rx="3.5" />
			<path d="M8.5 9V8h7v1M12 8v8M10.5 16h3" />
		</>
	),
	mosaic: (
		<>
			<rect x="4" y="4" width="16" height="16" rx="2.5" />
			<rect x="4" y="4" width="8" height="8" fill="currentColor" />
			<rect x="12" y="12" width="8" height="8" fill="currentColor" />
		</>
	),
	eraser: (
		<path d="m8 20-4-4 10-10a2 2 0 0 1 3 0l3 3a2 2 0 0 1 0 3L11 20ZM8 20h12" />
	),
	undo: <path d="M8 6 4 10l4 4M4 10h10a5 5 0 0 1 0 10h-3" />,
	redo: <path d="m16 6 4 4-4 4M20 10H10a5 5 0 0 0 0 10h3" />,
	ocr: <path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3M9 9h6M12 9v6" />,
	translate: (
		<path d="M4 6h8M8 4v2M6 6c0 3 3 6 6 7M12 6c0 3-3 6-6 7M13 20l4-9 4 9M14.5 17h5" />
	),
	qr: (
		<path d="M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h3v3h-3ZM20 14v6h-3" />
	),
	pin: <path d="m15 4 5 5-3 1-3 3 .5 4.5L12 15l-5 5M9 11l4-4" />,
	save: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
	saveAs: <path d="m6 10 6 6 6-6" />,
	cancel: <path d="M5 5l14 14M19 5 5 19" />,
	confirm: <path d="m5 12.5 4.5 4.5L19 7" />,
} satisfies Record<string, ReactNode>;

export type ToolIconName = keyof typeof TOOL_ICONS;
