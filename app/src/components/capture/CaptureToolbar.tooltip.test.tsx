import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptureToolbar } from "./CaptureToolbar";

afterEach(cleanup);

function setup() {
	render(
		<CaptureToolbar
			tool={null}
			onToolChange={vi.fn()}
			canUndo
			canRedo
			onUndo={vi.fn()}
			onRedo={vi.fn()}
			onPin={vi.fn()}
			onSave={vi.fn()}
			onSaveAs={vi.fn()}
			onCancel={vi.fn()}
			onConfirm={vi.fn()}
		/>,
	);
}

describe("CaptureToolbar — un solo tooltip", () => {
	it("ningún botón con tooltip propio lleva title: el nombre accesible es aria-label", () => {
		setup();
		for (const b of screen.getAllByRole("button")) {
			const label = b.getAttribute("aria-label");
			expect(label, "todo botón tiene aria-label").toBeTruthy();
			expect(b, `${label} no debe llevar title`).not.toHaveAttribute("title");
		}
	});
});
