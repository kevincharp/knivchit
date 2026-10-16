import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
	getCapturePreview: vi.fn(),
	cancelCapture: vi.fn(),
	show: vi.fn(),
	setFocus: vi.fn(),
	close: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
	getCapturePreview: m.getCapturePreview,
	cancelCapture: m.cancelCapture,
}));
vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		show: m.show,
		setFocus: m.setFocus,
		close: m.close,
	}),
}));

import { DiagOverlay } from "./DiagOverlay";
import {
	type DiagVariant,
	dataUrlToBlobUrl,
	readDiagVariant,
} from "./diagVariant";

beforeEach(() => {
	for (const fn of Object.values(m)) fn.mockReset();
	m.getCapturePreview.mockResolvedValue("data:image/png;base64,AAEC");
	URL.createObjectURL = vi.fn(() => "blob:diag");
	URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("readDiagVariant", () => {
	it("lee P1–P5 de la query", () => {
		expect(readDiagVariant("?window=capture-overlay&diag=3")).toBe(3);
		expect(readDiagVariant("?diag=P5")).toBe(5);
	});
	it("ausente, 0 o inválido devuelven null (overlay real)", () => {
		expect(readDiagVariant("?window=capture-overlay")).toBeNull();
		expect(readDiagVariant("?diag=0")).toBeNull();
		expect(readDiagVariant("?diag=9")).toBeNull();
		expect(readDiagVariant("?diag=x")).toBeNull();
	});
});

describe("dataUrlToBlobUrl", () => {
	it("decodifica el base64 a un Blob y devuelve su blob URL", () => {
		expect(dataUrlToBlobUrl("data:image/png;base64,AAEC")).toBe("blob:diag");
		const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
		expect(blob.size).toBe(3);
		expect(blob.type).toBe("image/png");
	});
});

describe("DiagOverlay", () => {
	for (const v of [1, 2, 3, 4, 5] as DiagVariant[]) {
		it(`P${v} monta, muestra su nombre y carga la imagen por blob URL`, async () => {
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			const { container } = render(<DiagOverlay variant={v} />);
			expect(screen.getByText(`P${v}`)).toBeInTheDocument();
			expect(log).toHaveBeenCalledWith(`[knivchit-diag] variante P${v}`);
			await waitFor(() =>
				expect(container.querySelector("img")?.getAttribute("src")).toBe(
					"blob:diag",
				),
			);
			log.mockRestore();
		});
	}
});
