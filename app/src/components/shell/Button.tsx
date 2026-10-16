import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary";
}

/** Botón del hub (40 px de alto). El primario es la acción principal de la página. */
export function Button({
	variant = "secondary",
	className = "",
	type = "button",
	...rest
}: ButtonProps) {
	const tone =
		variant === "primary"
			? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)] hover:brightness-110"
			: "border border-[var(--color-card-border)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]";
	return (
		<button
			{...rest}
			type={type}
			className={`inline-flex h-10 items-center justify-center rounded-full px-5 text-sm font-medium transition-[background-color,filter] duration-[var(--duration-ui)] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${tone} ${className}`}
		/>
	);
}
