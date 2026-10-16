import type { ReactNode } from "react";

/** Superficie plana del hub: sin sombra, separada por un borde de 1 px. */
export function Card({
	children,
	className = "",
	...rest
}: {
	children: ReactNode;
	className?: string;
} & React.HTMLAttributes<HTMLElement>) {
	return (
		<section
			{...rest}
			className={`rounded-[var(--radius-ui)] border border-[var(--color-card-border)] bg-[var(--color-card)] p-4 ${className}`}
		>
			{children}
		</section>
	);
}
