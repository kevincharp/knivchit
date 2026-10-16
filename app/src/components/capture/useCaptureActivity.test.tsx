import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureActivity } = vi.hoisted(() => ({ captureActivity: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ captureActivity }));

import { useCaptureActivity } from "./useCaptureActivity";

let notify: ReturnType<typeof useCaptureActivity>;
function Harness() {
	notify = useCaptureActivity();
	return null;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
	captureActivity.mockReset();
	captureActivity.mockResolvedValue(undefined);
	render(<Harness />);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("aviso de actividad al backend", () => {
	it("mousedown, mousemove y keydown llaman al wrapper", () => {
		fireEvent.mouseDown(document.body);
		fireEvent.mouseMove(document.body);
		fireEvent.keyDown(document.body, { key: "a" });
		expect(captureActivity).toHaveBeenCalledTimes(3);
	});

	it("los cambios de selección y de herramienta llaman al wrapper", () => {
		act(() => notify("selection"));
		act(() => notify("tool"));
		expect(captureActivity).toHaveBeenCalledTimes(2);
	});

	it("mousemove se limita a una llamada cada 5 s", () => {
		for (let i = 0; i < 50; i++) fireEvent.mouseMove(document.body);
		expect(captureActivity).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(4999);
		fireEvent.mouseMove(document.body);
		expect(captureActivity).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1);
		fireEvent.mouseMove(document.body);
		expect(captureActivity).toHaveBeenCalledTimes(2);
	});

	it("la selección y el teclado también se limitan a 1 s", () => {
		for (let i = 0; i < 20; i++) {
			act(() => notify("selection"));
			fireEvent.keyDown(document.body, { key: "a" });
		}
		expect(captureActivity).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1000);
		act(() => notify("selection"));
		expect(captureActivity).toHaveBeenCalledTimes(3);
	});

	it("un rechazo del IPC se ignora sin lanzar", async () => {
		captureActivity.mockRejectedValue(new Error("ipc caído"));
		expect(() => fireEvent.mouseDown(document.body)).not.toThrow();
		await vi.runAllTimersAsync();
		expect(captureActivity).toHaveBeenCalledTimes(1);
	});

	it("un lanzamiento síncrono del IPC se ignora sin lanzar", () => {
		captureActivity.mockImplementation(() => {
			throw new Error("sin IPC");
		});
		expect(() => fireEvent.keyDown(document.body, { key: "a" })).not.toThrow();
	});
});
