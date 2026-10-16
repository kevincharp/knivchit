import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { cancelCapture, getCapturePreview } from "../../../lib/tauri";
import { useNativeDragGuard } from "../../../lib/useNativeDragGuard";
import { resolveToken } from "../annotationPalette";
import { CaptureToolbar } from "../CaptureToolbar";
import { type DiagVariant, dataUrlToBlobUrl } from "./diagVariant";

interface Pt {
	x: number;
	y: number;
}

const SCRIM = "rgba(4, 5, 8, 0.55)";

function normRect(a: Pt, b: Pt) {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function block(parent: HTMLElement, color: string): HTMLDivElement {
	const d = document.createElement("div");
	d.style.cssText = `position:absolute;background:${color};pointer-events:none`;
	parent.appendChild(d);
	return d;
}

function place(el: HTMLElement, x: number, y: number, w: number, h: number) {
	el.style.left = `${x}px`;
	el.style.top = `${y}px`;
	el.style.width = `${Math.max(0, w)}px`;
	el.style.height = `${Math.max(0, h)}px`;
}

/** Engancha pointer events + rAF: `draw` corre a lo sumo una vez por frame, sin React. */
function wirePointer(
	root: HTMLElement,
	draw: (start: Pt, cur: Pt, dragging: boolean) => void,
): () => void {
	let start: Pt = { x: 0, y: 0 };
	let cur: Pt = { x: 0, y: 0 };
	let dragging = false;
	let raf = 0;
	const schedule = () => {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			draw(start, cur, dragging);
		});
	};
	const down = (e: PointerEvent) => {
		e.preventDefault();
		dragging = true;
		start = { x: e.clientX, y: e.clientY };
		cur = start;
		root.setPointerCapture(e.pointerId);
		schedule();
	};
	const move = (e: PointerEvent) => {
		cur = { x: e.clientX, y: e.clientY };
		schedule();
	};
	const up = () => {
		dragging = false;
		schedule();
	};
	root.addEventListener("pointerdown", down);
	root.addEventListener("pointermove", move);
	root.addEventListener("pointerup", up);
	root.addEventListener("pointercancel", up);
	return () => {
		root.removeEventListener("pointerdown", down);
		root.removeEventListener("pointermove", move);
		root.removeEventListener("pointerup", up);
		root.removeEventListener("pointercancel", up);
		if (raf) cancelAnimationFrame(raf);
	};
}

function mountP1(root: HTMLElement) {
	const dot = block(root, "rgba(76,130,255,0.8)");
	place(dot, 0, 0, 40, 40);
	return wirePointer(root, (_s, c) => {
		dot.style.transform = `translate(${c.x - 20}px, ${c.y - 20}px)`;
	});
}

function mountP2(root: HTMLElement) {
	const NS = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(NS, "svg");
	svg.setAttribute("width", String(window.innerWidth));
	svg.setAttribute("height", String(window.innerHeight));
	svg.style.cssText = "position:absolute;inset:0;pointer-events:none";
	svg.innerHTML = `<defs><mask id="diag-cutout"><rect width="100%" height="100%" fill="white"/><rect id="diag-hole" fill="black" rx="24"/></mask></defs><rect width="100%" height="100%" fill="${SCRIM}" mask="url(#diag-cutout)"/>`;
	root.appendChild(svg);
	const hole = svg.querySelector("#diag-hole") as SVGRectElement;
	const border = block(root, "transparent");
	border.style.border = "2px solid var(--color-accent)";
	border.style.borderRadius = "24px";
	return wirePointer(root, (s, c) => {
		const r = normRect(s, c);
		hole.setAttribute("x", String(r.x));
		hole.setAttribute("y", String(r.y));
		hole.setAttribute("width", String(r.w));
		hole.setAttribute("height", String(r.h));
		place(border, r.x, r.y, r.w, r.h);
	});
}

function mountP3(root: HTMLElement) {
	const top = block(root, SCRIM);
	const bottom = block(root, SCRIM);
	const left = block(root, SCRIM);
	const right = block(root, SCRIM);
	const border = block(root, "transparent");
	border.style.border = "2px solid var(--color-accent)";
	const W = window.innerWidth;
	const H = window.innerHeight;
	return wirePointer(root, (s, c) => {
		const r = normRect(s, c);
		place(top, 0, 0, W, r.y);
		place(bottom, 0, r.y + r.h, W, H - r.y - r.h);
		place(left, 0, r.y, r.x, r.h);
		place(right, r.x + r.w, r.y, W - r.x - r.w, r.h);
		place(border, r.x, r.y, r.w, r.h);
	});
}

function mountP4(root: HTMLElement) {
	const canvas = document.createElement("canvas");
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
	canvas.style.cssText = "position:absolute;inset:0;pointer-events:none";
	root.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	const red = resolveToken("--color-ann-red");
	return wirePointer(root, (s, c, dragging) => {
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.strokeStyle = red;
		ctx.lineWidth = 4;
		ctx.beginPath();
		ctx.moveTo(dragging ? s.x : c.x, dragging ? s.y : c.y);
		ctx.lineTo(c.x, c.y);
		ctx.stroke();
	});
}

function mountP5(root: HTMLElement, img: HTMLImageElement) {
	const dpr = window.devicePixelRatio || 1;
	const W = window.innerWidth;
	const H = window.innerHeight;
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(W * dpr);
	canvas.height = Math.round(H * dpr);
	canvas.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px`;
	root.appendChild(canvas);
	const ctx = canvas.getContext("2d");
	const accent = resolveToken("--color-accent");
	return wirePointer(root, (s, c, dragging) => {
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);
		ctx.drawImage(img, 0, 0, W, H);
		ctx.fillStyle = SCRIM;
		const r = normRect(s, c);
		if (!dragging && r.w === 0) {
			ctx.fillRect(0, 0, W, H);
			return;
		}
		const radius = Math.min(24, r.w / 2, r.h / 2);
		ctx.beginPath();
		ctx.rect(0, 0, W, H);
		ctx.roundRect(r.x, r.y, r.w, r.h, radius);
		ctx.fill("evenodd");
		ctx.strokeStyle = accent;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.roundRect(r.x, r.y, r.w, r.h, radius);
		ctx.stroke();
		ctx.fillStyle = accent;
		for (const fx of [0, 0.5, 1]) {
			for (const fy of [0, 0.5, 1]) {
				if (fx === 0.5 && fy === 0.5) continue;
				ctx.fillRect(r.x + r.w * fx - 5, r.y + r.h * fy - 5, 10, 10);
			}
		}
	});
}

async function closeOverlay() {
	try {
		await cancelCapture();
	} catch {
		// Sin captura pendiente: igual hay que cerrar.
	}
	await getCurrentWindow().close();
}

/**
 * Variantes mínimas del overlay (P1–P5) para aislar qué capa de WebKitGTK
 * provoca la pantalla duplicada. Todo el movimiento es imperativo (style /
 * atributos / 2D directo desde el handler, agrupado con rAF): ningún setState
 * por evento. Esc o el botón Cancelar de P5 cierran.
 */
export function DiagOverlay({ variant }: { variant: DiagVariant }) {
	const rootRef = useRef<HTMLDivElement>(null);
	useNativeDragGuard({ blockMouseDown: true });
	const [src, setSrc] = useState<string | null>(null);
	const [img, setImg] = useState<HTMLImageElement | null>(null);

	useEffect(() => {
		console.log(`[knivchit-diag] variante P${variant}`);
		let url: string | null = null;
		let alive = true;
		getCapturePreview()
			.then((dataUrl) => {
				if (!alive) return;
				url = dataUrlToBlobUrl(dataUrl);
				setSrc(url);
			})
			.catch((e) => console.error("[knivchit-diag] sin captura", e));
		return () => {
			alive = false;
			if (url) URL.revokeObjectURL(url);
		};
	}, [variant]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeOverlay();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		const root = rootRef.current;
		if (!root || !img) return;
		let unmount: () => void;
		if (variant === 1) unmount = mountP1(root);
		else if (variant === 2) unmount = mountP2(root);
		else if (variant === 3) unmount = mountP3(root);
		else if (variant === 4) unmount = mountP4(root);
		else unmount = mountP5(root, img);
		return () => {
			unmount();
			// Deja solo lo que React posee (img/etiqueta/toolbar).
			for (const el of Array.from(root.children)) {
				if (!el.hasAttribute("data-react")) el.remove();
			}
		};
	}, [variant, img]);

	return (
		<div
			ref={rootRef}
			tabIndex={-1}
			className="capture-surface fixed inset-0 overflow-hidden outline-none"
			style={{ cursor: "crosshair", touchAction: "none" }}
		>
			{src && (
				<img
					data-react=""
					src={src}
					alt=""
					draggable={false}
					onLoad={(e) => {
						setImg(e.currentTarget);
						const w = getCurrentWindow();
						w.show();
						w.setFocus();
						rootRef.current?.focus();
					}}
					className="pointer-events-none absolute inset-0 h-full w-full"
					style={{
						objectFit: "fill",
						visibility: variant === 5 ? "hidden" : "visible",
					}}
				/>
			)}
			<div
				data-react=""
				className="pointer-events-none absolute top-4 left-4 rounded-full bg-[var(--color-glass-solid)] px-3 py-1 font-mono text-sm text-[var(--color-fg)]"
			>
				P{variant}
			</div>
			{variant === 5 && (
				<div
					data-react=""
					className="absolute bottom-8 left-1/2 -translate-x-1/2"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<CaptureToolbar
						tool={null}
						onToolChange={() => {}}
						canUndo={false}
						canRedo={false}
						onUndo={() => {}}
						onRedo={() => {}}
						onPin={() => {}}
						onSave={() => {}}
						onSaveAs={() => {}}
						onCancel={closeOverlay}
						onConfirm={() => {}}
					/>
				</div>
			)}
		</div>
	);
}
