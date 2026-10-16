import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRafCallback } from "./useRafCallback";

let frames: FrameRequestCallback[] = [];

function flush() {
	const pending = frames;
	frames = [];
	for (const cb of pending) cb(0);
}

beforeEach(() => {
	frames = [];
	let id = 0;
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
		frames.push(cb);
		return ++id;
	});
	vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("useRafCallback", () => {
	it("colapsa varias llamadas en el mismo frame a una sola, con los últimos argumentos", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useRafCallback(fn));
		act(() => {
			result.current(1);
			result.current(2);
			result.current(3);
		});
		expect(fn).not.toHaveBeenCalled();
		expect(frames).toHaveLength(1);
		act(() => flush());
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith(3);
	});

	it("llamadas en frames distintos producen una invocación por frame", () => {
		const fn = vi.fn();
		const { result } = renderHook(() => useRafCallback(fn));
		act(() => {
			result.current("a");
		});
		act(() => flush());
		act(() => {
			result.current("b");
		});
		act(() => flush());
		expect(fn).toHaveBeenNthCalledWith(1, "a");
		expect(fn).toHaveBeenNthCalledWith(2, "b");
	});

	it("usa siempre la versión más reciente de la función, sin perder el frame en vuelo", () => {
		const first = vi.fn();
		const second = vi.fn();
		const { result, rerender } = renderHook(
			({ fn }: { fn: (n: number) => void }) => useRafCallback(fn),
			{ initialProps: { fn: first } },
		);
		act(() => {
			result.current(1);
		});
		rerender({ fn: second });
		act(() => flush());
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledWith(1);
	});

	it("cancela el frame pendiente al desmontar", () => {
		const cancel = vi.fn();
		vi.stubGlobal("cancelAnimationFrame", cancel);
		const fn = vi.fn();
		const { result, unmount } = renderHook(() => useRafCallback(fn));
		act(() => {
			result.current(1);
		});
		unmount();
		expect(cancel).toHaveBeenCalled();
	});
});
