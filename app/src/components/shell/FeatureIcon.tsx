import type { ReactNode } from "react";

/** Icono de rejilla 24 px con el trazo del sistema (2, extremos redondeados). */
export function FeatureIcon({
	children,
	size = 22,
}: {
	children: ReactNode;
	size?: number;
}) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}
