/** Insignia «Pronto» de las funciones que todavía no existen. */
export function SoonBadge({ className = "" }: { className?: string }) {
	return (
		<span
			className={`rounded-full bg-[var(--color-badge)] px-1.5 py-px text-[10px] leading-[14px] font-medium text-[var(--color-badge-ink)] ${className}`}
		>
			Pronto
		</span>
	);
}
