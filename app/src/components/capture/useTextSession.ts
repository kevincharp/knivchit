import { useRef, useState } from "react";
import {
	type Annotation,
	type AnnotationHistory,
	addAnnotation,
	type Point,
	removeAnnotation,
	replaceAnnotation,
} from "./annotations";

interface Session {
	id: string;
	/** Historial ANTES de la sesión: al terminar, toda la sesión se resume en UN paso sobre él. */
	base: AnnotationHistory;
	isNew: boolean;
}

interface Options {
	history: AnnotationHistory;
	onHistoryChange: (history: AnnotationHistory) => void;
	onSelect?: (id: string | null) => void;
	/** Texto nuevo (vacío) en el punto dado, con las opciones vigentes de la herramienta. */
	makeText: (at: Point) => Annotation;
}

/**
 * Sesión de escritura de un texto, nuevo o existente. Mientras dura, la anotación
 * VIVE en el historial (así las manijas, el recuadro, el color, el tamaño y la
 * alineación actúan sobre ella con el mismo código que para cualquier figura) pero
 * sin que cada cambio sea un paso: al terminar, el historial pasa a ser el de antes
 * de la sesión más UN solo paso (alta o sustitución), o el de antes si quedó igual.
 * Un texto vacío no se queda: el nuevo se descarta y el existente se elimina.
 */
export function useTextSession({
	history,
	onHistoryChange,
	onSelect,
	makeText,
}: Options) {
	const sessionRef = useRef<Session | null>(null);
	const [session, setSession] = useState<{ id: string; isNew: boolean } | null>(
		null,
	);
	// Último historial conocido, también el que se acaba de emitir en este mismo
	// evento: así varias operaciones seguidas (cerrar una sesión y abrir otra en un
	// clic) encadenan sobre el resultado de la anterior y no sobre el prop viejo.
	const latest = useRef(history);
	latest.current = history;
	function emit(next: AnnotationHistory) {
		latest.current = next;
		onHistoryChange(next);
	}

	function open(next: Session) {
		sessionRef.current = next;
		setSession({ id: next.id, isNew: next.isNew });
		onSelect?.(next.id);
	}

	/** Texto nuevo en `at`: queda en el historial (vacío, sin paso) hasta terminar la sesión. */
	function startNew(at: Point) {
		const base = latest.current;
		const text = makeText(at);
		emit({ ...base, present: [...base.present, text] });
		open({ id: text.id, base, isNew: true });
	}

	/** Edita el contenido (y lo demás) de un texto existente. */
	function startEdit(id: string) {
		open({ id, base: latest.current, isNew: false });
	}

	/** Refleja lo que se escribe en la anotación, sin crear pasos. */
	function sync(value: string) {
		const s = sessionRef.current;
		if (!s) return;
		const h = latest.current;
		emit({
			...h,
			present: h.present.map((a) =>
				a.id === s.id ? { ...a, text: value } : a,
			),
		});
	}

	/** Termina la sesión con el contenido `value` (o el último sincronizado). */
	function end(value?: string) {
		const s = sessionRef.current;
		if (!s) return;
		sessionRef.current = null;
		setSession(null);
		const h = latest.current;
		const current = h.present.find((a) => a.id === s.id);
		// Deshecho a mano mientras tanto: no hay nada que resumir.
		if (!current) return;
		const text = (value ?? current.text ?? "").trim();
		if (!text) {
			emit(s.isNew ? s.base : removeAnnotation(s.base, s.id));
			onSelect?.(null);
			return;
		}
		const final = { ...current, text };
		if (s.isNew) {
			emit(addAnnotation(s.base, final));
		} else {
			const original = s.base.present.find((a) => a.id === s.id);
			emit(
				JSON.stringify(original) === JSON.stringify(final)
					? s.base
					: replaceAnnotation(s.base, final),
			);
		}
		onSelect?.(final.id);
	}

	return { session, startNew, startEdit, sync, end, latest };
}
