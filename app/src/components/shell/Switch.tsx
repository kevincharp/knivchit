/** Interruptor accesible (role=switch); el nombre lo da `aria-labelledby`. */
export function Switch({
	checked,
	onChange,
	labelledBy,
	disabled,
}: {
	checked: boolean;
	onChange: (next: boolean) => void;
	labelledBy: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-labelledby={labelledBy}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className={`relative h-[26px] w-11 shrink-0 rounded-full border transition-colors duration-[var(--duration-ui)] ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50 motion-reduce:transition-none ${
				checked
					? "border-[var(--color-accent-fill)] bg-[var(--color-accent-fill)]"
					: "border-[var(--color-card-border)] bg-[var(--color-card-hover)]"
			}`}
		>
			<span
				aria-hidden="true"
				className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform duration-[var(--duration-ui)] ease-out motion-reduce:transition-none ${
					checked
						? "translate-x-[18px] bg-[var(--color-on-accent)]"
						: "bg-[var(--color-fg-muted)]"
				}`}
			/>
		</button>
	);
}
