import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptureShortcuts } from "./useCaptureShortcuts";

afterEach(cleanup);

function Harness({
	handlers,
}: {
	handlers: Parameters<typeof useCaptureShortcuts>[0];
}) {
	useCaptureShortcuts(handlers);
	return (
		<div>
			<textarea aria-label="texto" />
			<input aria-label="campo" />
			<button type="button">botón</button>
		</div>
	);
}

function setup() {
	const h = {
		onCancel: vi.fn(),
		onConfirm: vi.fn(),
		onCopy: vi.fn(),
		onSave: vi.fn(),
		onSaveAs: vi.fn(),
		onUndo: vi.fn(),
		onRedo: vi.fn(),
		onToolKey: vi.fn(),
		onHelp: vi.fn(),
		onDeleteSelected: vi.fn(),
	};
	const view = render(<Harness handlers={h} />);
	return { h, view };
}

function called(h: ReturnType<typeof setup>["h"]) {
	return Object.entries(h)
		.filter(([, fn]) => fn.mock.calls.length > 0)
		.map(([name, fn]) => `${name}:${fn.mock.calls.length}`);
}

describe("atajos del overlay (spec §2.3)", () => {
	it("Esc cancela", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(called(h)).toEqual(["onCancel:1"]);
	});

	it("Enter confirma (copiar y cerrar)", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "Enter" });
		expect(called(h)).toEqual(["onConfirm:1"]);
	});

	it("Ctrl+C copia, Ctrl+S guarda", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "c", ctrlKey: true });
		fireEvent.keyDown(document.body, { key: "s", ctrlKey: true });
		expect(called(h)).toEqual(["onCopy:1", "onSave:1"]);
	});

	it("Ctrl+Shift+S abre «Guardar como…», no Guardar", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, {
			key: "S",
			ctrlKey: true,
			shiftKey: true,
		});
		expect(called(h)).toEqual(["onSaveAs:1"]);
	});

	it("Ctrl+Z deshace y Ctrl+Shift+Z rehace", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
		expect(called(h)).toEqual(["onUndo:1"]);
		fireEvent.keyDown(document.body, {
			key: "Z",
			ctrlKey: true,
			shiftKey: true,
		});
		expect(called(h)).toEqual(["onUndo:1", "onRedo:1"]);
	});

	it("Ctrl+Shift+Z no deshace", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, {
			key: "Z",
			ctrlKey: true,
			shiftKey: true,
		});
		expect(h.onUndo).not.toHaveBeenCalled();
	});

	it("Meta (⌘) equivale a Ctrl", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "s", metaKey: true });
		expect(h.onSave).toHaveBeenCalledOnce();
	});

	it("las letras sin Ctrl no hacen nada", () => {
		const { h } = setup();
		for (const key of ["c", "s", "z", "a"])
			fireEvent.keyDown(document.body, { key });
		expect(called(h)).toEqual([]);
	});

	it("Supr y Retroceso borran la seleccionada", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "Delete" });
		fireEvent.keyDown(document.body, { key: "Backspace" });
		expect(called(h)).toEqual(["onDeleteSelected:2"]);
	});

	it("Alt+letra elige herramienta (por la tecla física)", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "f", code: "KeyF", altKey: true });
		fireEvent.keyDown(document.body, { key: "ñ", code: "KeyH", altKey: true });
		expect(h.onToolKey.mock.calls.map((c) => c[0])).toEqual([
			"arrow",
			"select",
		]);
	});

	it("la letra sola (y V) elige herramienta fuera del texto", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "v", code: "KeyV" });
		fireEvent.keyDown(document.body, { key: "r", code: "KeyR" });
		expect(h.onToolKey.mock.calls.map((c) => c[0])).toEqual(["select", "rect"]);
	});

	it("Ctrl+letra nunca cambia de herramienta (Ctrl+C, Ctrl+S, Ctrl+V…)", () => {
		const { h } = setup();
		for (const code of ["KeyC", "KeyS", "KeyV", "KeyR", "KeyF"]) {
			fireEvent.keyDown(document.body, { key: "x", code, ctrlKey: true });
		}
		expect(h.onToolKey).not.toHaveBeenCalled();
	});

	it("escribiendo un texto: la letra sola no actúa, Alt+letra sí, confirma el texto (blur) y cambia", () => {
		const { h, view } = setup();
		const el = view.getByLabelText("texto");
		el.focus();
		fireEvent.keyDown(el, { key: "f", code: "KeyF" });
		fireEvent.keyDown(el, { key: "v", code: "KeyV" });
		fireEvent.keyDown(el, { key: "Backspace", code: "Backspace" });
		expect(h.onToolKey).not.toHaveBeenCalled();
		expect(h.onDeleteSelected).not.toHaveBeenCalled();
		fireEvent.keyDown(el, { key: "f", code: "KeyF", altKey: true });
		expect(h.onToolKey).toHaveBeenCalledWith("arrow");
		expect(el).not.toHaveFocus();
	});

	it("«?» abre la ayuda, pero no escribiendo un texto", () => {
		const { h, view } = setup();
		fireEvent.keyDown(document.body, {
			key: "?",
			code: "Slash",
			shiftKey: true,
		});
		expect(h.onHelp).toHaveBeenCalledOnce();
		const el = view.getByLabelText("texto");
		el.focus();
		fireEvent.keyDown(el, { key: "?", code: "Slash", shiftKey: true });
		expect(h.onHelp).toHaveBeenCalledOnce();
	});

	it("Ctrl+Enter no confirma", () => {
		const { h } = setup();
		fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
		expect(h.onConfirm).not.toHaveBeenCalled();
	});

	it("no actúan mientras se escribe en un textarea o input (ni Esc ni Enter)", () => {
		const { h, view } = setup();
		for (const name of ["texto", "campo"]) {
			const el = view.getByLabelText(name);
			el.focus();
			for (const init of [
				{ key: "Escape" },
				{ key: "Enter" },
				{ key: "z", ctrlKey: true },
				{ key: "c", ctrlKey: true },
				{ key: "s", ctrlKey: true },
			]) {
				fireEvent.keyDown(el, init);
			}
		}
		expect(called(h)).toEqual([]);
	});

	it("tras desmontar, ya no escucha el teclado", () => {
		const { h, view } = setup();
		view.unmount();
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(h.onCancel).not.toHaveBeenCalled();
	});

	it("previene la acción por defecto del navegador en Ctrl+S", () => {
		setup();
		const ev = new KeyboardEvent("keydown", {
			key: "s",
			ctrlKey: true,
			cancelable: true,
			bubbles: true,
		});
		document.body.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
	});
});

describe("una pulsación se procesa una sola vez aunque el atajo re-renderice", () => {
	// Causa del Alt+H «roto» en uso real: el manejador de `document` (captura)
	// cambia el estado, React re-renderiza y re-registra los listeners ANTES de
	// que el mismo evento llegue a `window`; si la deduplicación vive dentro del
	// efecto, el listener nuevo no ha visto el evento y lo procesa otra vez
	// (la herramienta se enciende y se apaga en la misma pulsación).
	function Rerendering({ onTool }: { onTool: () => void }) {
		const [, setN] = useState(0);
		useCaptureShortcuts({
			onCancel: vi.fn(),
			onConfirm: vi.fn(),
			onCopy: vi.fn(),
			onSave: vi.fn(),
			onSaveAs: vi.fn(),
			onUndo: vi.fn(),
			onRedo: vi.fn(),
			onHelp: vi.fn(),
			onDeleteSelected: vi.fn(),
			onToolKey: () => {
				onTool();
				flushSync(() => setN((n) => n + 1));
			},
		});
		return <button type="button">botón</button>;
	}

	it("Alt+H llama a onToolKey una vez", () => {
		const onTool = vi.fn();
		const { getByRole } = render(<Rerendering onTool={onTool} />);
		fireEvent.keyDown(getByRole("button"), {
			key: "h",
			code: "KeyH",
			altKey: true,
		});
		expect(onTool).toHaveBeenCalledTimes(1);
	});
});

describe("autorepetición del teclado", () => {
	it("deshacer y rehacer sí repiten; Supr, Enter y Alt+letra no", () => {
		const { h } = setup();
		const press = (init: KeyboardEventInit & { key: string }) =>
			fireEvent.keyDown(document.body, { repeat: true, ...init });
		press({ key: "z", code: "KeyZ", ctrlKey: true });
		press({ key: "Z", code: "KeyZ", ctrlKey: true, shiftKey: true });
		press({ key: "Delete" });
		press({ key: "Enter" });
		press({ key: "h", code: "KeyH", altKey: true });
		expect(called(h)).toEqual(["onUndo:1", "onRedo:1"]);
	});
});
