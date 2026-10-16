import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecordResult } from "../../lib/tauri";
import { ShortcutRecorder } from "./ShortcutRecorder";

afterEach(cleanup);

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const OK_SUPER_S: RecordResult = { accel: "<Super>s", status: "ok" };

async function setup(
	record: () => Promise<RecordResult>,
	check: (a: string) => Promise<string[]> = async () => [],
) {
	const onAccept = vi.fn();
	const onCancel = vi.fn();
	const view = render(
		<ShortcutRecorder
			record={record}
			check={check}
			onAccept={onAccept}
			onCancel={onCancel}
		/>,
	);
	await act(async () => {});
	return { onAccept, onCancel, view };
}

describe("ShortcutRecorder — grabación en la extensión", () => {
	it("al abrirse pide a la extensión una sola vez y avisa de cómo cancelar", async () => {
		const d = deferred<RecordResult>();
		const record = vi.fn(() => d.promise);
		await setup(record);
		expect(record).toHaveBeenCalledTimes(1);
		const g = screen.getByRole("group", { name: "Asignar atajo" });
		expect(g).toHaveTextContent(
			"Pulsa la combinación; Esc o un clic cancelan.",
		);
		expect(g.querySelector("[aria-live=polite]")).not.toBeNull();
		// El modal se traga el ratón: no hay botón que no se pueda pulsar.
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("una combinación sin conflicto se acepta", async () => {
		const { onAccept } = await setup(async () => OK_SUPER_S);
		await act(async () => {});
		expect(onAccept).toHaveBeenCalledWith("<Super>s");
	});

	it("«cancelled» (Esc o clic en la extensión) cierra sin cambios", async () => {
		const { onAccept, onCancel } = await setup(async () => ({
			accel: "",
			status: "cancelled",
		}));
		await act(async () => {});
		expect(onCancel).toHaveBeenCalledOnce();
		expect(onAccept).not.toHaveBeenCalled();
	});

	it.each([
		["timeout", undefined, /Se agotó el tiempo/],
		["busy", undefined, /Espera un momento y reintenta/],
		["invalid", undefined, /no es válida/],
		[
			"unavailable",
			undefined,
			/GNOME no permite capturar el teclado; cierra el diálogo que esté abierto e inténtalo de nuevo/,
		],
		["invalid", "Falta un modificador.", /Falta un modificador\./],
		[
			"unavailable",
			"Otra extensión tiene un diálogo abierto.",
			/Otra extensión tiene un diálogo abierto\./,
		],
	] as const)(
		"%s (%s) muestra el motivo y deja reintentar o cerrar",
		async (status, message, text) => {
			const { onAccept, onCancel } = await setup(async () => ({
				accel: "",
				status,
				message,
			}));
			await act(async () => {});
			expect(
				screen.getByRole("group", { name: "Asignar atajo" }),
			).toHaveTextContent(text);
			expect(
				screen.getByRole("button", { name: "Reintentar" }),
			).toBeInTheDocument();
			fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
			expect(onCancel).toHaveBeenCalledOnce();
			expect(onAccept).not.toHaveBeenCalled();
		},
	);

	it("si la extensión falla (p. ej. extension_inactive) lo muestra y permite reintentar", async () => {
		const record = vi
			.fn()
			.mockRejectedValueOnce(new Error("La extensión no está activa."))
			.mockResolvedValueOnce(OK_SUPER_S);
		const { onAccept } = await setup(record);
		await act(async () => {});
		expect(
			screen.getByText("La extensión no está activa."),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
		await act(async () => {});
		expect(record).toHaveBeenCalledTimes(2);
		expect(onAccept).toHaveBeenCalledWith("<Super>s");
	});

	it("un conflicto no acepta nada hasta «Usar de todos modos»", async () => {
		const { onAccept } = await setup(
			async () => OK_SUPER_S,
			async () => ["Captura de pantalla (GNOME)"],
		);
		await act(async () => {});
		expect(screen.getByRole("alert")).toHaveTextContent(
			"Super+S ya lo usa: Captura de pantalla (GNOME).",
		);
		expect(onAccept).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", { name: "Usar de todos modos" }),
		);
		expect(onAccept).toHaveBeenCalledWith("<Super>s");
	});

	it("«Elegir otro» graba de nuevo", async () => {
		const record = vi
			.fn()
			.mockResolvedValueOnce(OK_SUPER_S)
			.mockResolvedValueOnce({ accel: "<Control>j", status: "ok" });
		const check = vi
			.fn()
			.mockResolvedValueOnce(["Otro atajo"])
			.mockResolvedValueOnce([]);
		const { onAccept } = await setup(record, check);
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "Elegir otro" }));
		await act(async () => {});
		expect(onAccept).toHaveBeenCalledTimes(1);
		expect(onAccept).toHaveBeenCalledWith("<Control>j");
	});

	it("si falla la comprobación de conflictos vuelve a ofrecer reintentar y no acepta", async () => {
		const { onAccept } = await setup(
			async () => OK_SUPER_S,
			async () => {
				throw new Error("la extensión no responde");
			},
		);
		await act(async () => {});
		expect(screen.getByText("la extensión no responde")).toBeInTheDocument();
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("el primer intento puede ser una sugerencia ya elegida, sin grabar", async () => {
		const record = vi.fn();
		const onAccept = vi.fn();
		render(
			<ShortcutRecorder
				record={record}
				first={async () => ({ accel: "<Super><Shift>c", status: "ok" })}
				check={async () => []}
				onAccept={onAccept}
				onCancel={() => {}}
			/>,
		);
		await act(async () => {});
		expect(record).not.toHaveBeenCalled();
		expect(onAccept).toHaveBeenCalledWith("<Super><Shift>c");
	});
});

describe("ShortcutRecorder — carreras con la comprobación de conflictos", () => {
	it("cancelar con el botón mientras se comprueba no asigna después", async () => {
		const d = deferred<string[]>();
		const { onAccept, onCancel } = await setup(
			async () => OK_SUPER_S,
			() => d.promise,
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		expect(onCancel).toHaveBeenCalledTimes(1);
		await act(async () => d.resolve([]));
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("Esc mientras se comprueba también cancela y no asigna después", async () => {
		const d = deferred<string[]>();
		const { onAccept, onCancel } = await setup(
			async () => OK_SUPER_S,
			() => d.promise,
		);
		fireEvent.keyDown(screen.getByRole("group", { name: "Asignar atajo" }), {
			key: "Escape",
		});
		expect(onCancel).toHaveBeenCalledTimes(1);
		await act(async () => d.resolve([]));
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("desmontar mientras se comprueba no asigna ni falla al resolverse", async () => {
		const d = deferred<string[]>();
		const { onAccept, view } = await setup(
			async () => OK_SUPER_S,
			() => d.promise,
		);
		view.unmount();
		await act(async () => d.resolve([]));
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("desmontar mientras la extensión graba descarta el resultado", async () => {
		const d = deferred<RecordResult>();
		const { onAccept, view } = await setup(() => d.promise);
		view.unmount();
		await act(async () => d.resolve(OK_SUPER_S));
		expect(onAccept).not.toHaveBeenCalled();
	});

	it("un conflicto que llega tras cancelar no se muestra ni se acepta", async () => {
		const d = deferred<string[]>();
		const { onAccept } = await setup(
			async () => OK_SUPER_S,
			() => d.promise,
		);
		fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
		await act(async () => d.resolve(["Captura de pantalla (GNOME)"]));
		expect(onAccept).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("dos grabaciones seguidas: la respuesta tardía de la primera no cuenta; la de la segunda sí", async () => {
		const first = deferred<string[]>();
		const second = deferred<string[]>();
		const check = vi
			.fn()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const onAccept = vi.fn();
		const one = render(
			<ShortcutRecorder
				record={async () => OK_SUPER_S}
				check={check}
				onAccept={onAccept}
				onCancel={() => {}}
			/>,
		);
		await act(async () => {});
		one.unmount();
		render(
			<ShortcutRecorder
				record={async () => ({ accel: "<Control>k", status: "ok" })}
				check={check}
				onAccept={onAccept}
				onCancel={() => {}}
			/>,
		);
		await act(async () => {});
		await act(async () => first.resolve([]));
		expect(onAccept).not.toHaveBeenCalled();
		await act(async () => second.resolve([]));
		expect(onAccept).toHaveBeenCalledTimes(1);
		expect(onAccept).toHaveBeenCalledWith("<Control>k");
	});

	it("«Elegir otro» deja sin efecto una comprobación anterior pendiente", async () => {
		const pending = deferred<RecordResult>();
		const record = vi
			.fn()
			.mockResolvedValueOnce(OK_SUPER_S)
			.mockReturnValueOnce(pending.promise);
		const { onAccept } = await setup(record, async () => ["Otro atajo"]);
		await act(async () => {});
		fireEvent.click(screen.getByRole("button", { name: "Elegir otro" }));
		expect(onAccept).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
	});
});
