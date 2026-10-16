import { useId } from "react";

/**
 * Símbolo de Knivchit (S7): hoja en el azul de marca y mango en nogal.
 * El nogal es solo de la marca (logo e icono), no un color de interfaz.
 * `size` es el alto en px.
 */
export function LogoMark({ size = 22 }: { size?: number }) {
	const uid = useId().replace(/:/g, "");
	const blade = `${uid}-b`;
	const handle = `${uid}-h`;
	return (
		<svg
			viewBox="0 8 64 48"
			width={(size * 64) / 48}
			height={size}
			aria-hidden="true"
			style={{ pointerEvents: "none" }}
		>
			<g transform="translate(0 -3)">
				<mask
					id={blade}
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="64"
					height="64"
				>
					<rect width="64" height="64" fill="white" />
					<rect
						x="6"
						y="38"
						width="48"
						height="16"
						rx="8"
						fill="black"
						stroke="black"
						strokeWidth="3.4"
					/>
					<g transform="translate(15 46) rotate(-34)">
						<circle cx="16.5" cy="-6.4" r="2.9" fill="black" />
					</g>
				</mask>
				<mask
					id={handle}
					maskUnits="userSpaceOnUse"
					x="0"
					y="0"
					width="64"
					height="64"
				>
					<rect width="64" height="64" fill="white" />
					<circle cx="15" cy="46" r="3.3" fill="black" />
				</mask>
				<g mask={`url(#${blade})`}>
					<path
						fill="var(--color-brand-blade)"
						transform="translate(15 46) rotate(-34)"
						d="M0 -6.6 H23.9 C35.9 -6.6 43.2 -1.0 46 6.6 H0 Z"
					/>
				</g>
				<g mask={`url(#${handle})`}>
					<rect
						fill="var(--color-brand-wood)"
						x="6"
						y="38"
						width="48"
						height="16"
						rx="8"
					/>
				</g>
				<circle fill="var(--color-brand-blade)" cx="15" cy="46" r="1.7" />
			</g>
		</svg>
	);
}
