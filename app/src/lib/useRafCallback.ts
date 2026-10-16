import { useCallback, useEffect, useRef } from "react";

/**
 * Colapsa llamadas rápidas (p. ej. pointermove al mover/redimensionar la
 * selección) a como mucho una por frame, siempre con los argumentos más
 * recientes. En WebKitGTK (compositor por software) procesar cada evento tal
 * cual deja que se acumule una cola cuando el trabajo por evento no entra en
 * 16 ms: la UI «se traba» y luego salta de golpe al vaciarla. Con esto el
 * trabajo real queda acotado a una vez por frame, igual que el repintado.
 */
export function useRafCallback<Args extends unknown[]>(
	fn: (...args: Args) => void,
): (...args: Args) => void {
	const fnRef = useRef(fn);
	fnRef.current = fn;
	const rafId = useRef<number | null>(null);
	const pendingArgs = useRef<Args | null>(null);

	useEffect(
		() => () => {
			if (rafId.current !== null) cancelAnimationFrame(rafId.current);
		},
		[],
	);

	return useCallback((...args: Args) => {
		pendingArgs.current = args;
		if (rafId.current !== null) return;
		rafId.current = requestAnimationFrame(() => {
			rafId.current = null;
			const latest = pendingArgs.current;
			pendingArgs.current = null;
			if (latest) fnRef.current(...latest);
		});
	}, []);
}
