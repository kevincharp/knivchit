import { useEffect, useRef, useState } from "react";
import { createRecents } from "../../lib/emoji/recents";
import {
	closePicker,
	onPickerShow,
	type PickerTab,
	pickEmoji,
	pickerActivity,
} from "../../lib/tauri";
import { SoonBadge } from "../shell/SoonBadge";
import { EmojiTab } from "./EmojiTab";
import { usePickerKeys } from "./usePickerKeys";

const ACTIVITY_INTERVAL_MS = 1000;
const FLASH_MS = 1500;
const TABS: { id: PickerTab; label: string }[] = [
	{ id: "emoji", label: "Emojis" },
	{ id: "clipboard", label: "Portapapeles" },
];

function initialTab(): PickerTab {
	const tab = new URLSearchParams(window.location.search).get("tab");
	return tab === "clipboard" ? "clipboard" : "emoji";
}

export function Picker() {
	const [tab, setTab] = useState<PickerTab>(initialTab);
	const [query, setQuery] = useState("");
	const [recents] = useState(createRecents);
	const [recentList, setRecentList] = useState<string[]>([]);
	const [focusToken, setFocusToken] = useState(0);
	const [flash, setFlash] = useState<string | null>(null);
	const lastActivity = useRef(Number.NEGATIVE_INFINITY);

	useEffect(() => {
		const stop = onPickerShow((next) => {
			setTab(next);
			setFocusToken((n) => n + 1);
		});
		return () => {
			stop.then((unlisten) => unlisten());
		};
	}, []);

	useEffect(() => {
		if (!flash) return;
		const timer = setTimeout(() => setFlash(null), FLASH_MS);
		return () => clearTimeout(timer);
	}, [flash]);

	const reportActivity = () => {
		const now = Date.now();
		if (now - lastActivity.current < ACTIVITY_INTERVAL_MS) return;
		lastActivity.current = now;
		pickerActivity();
	};

	const pick = async (char: string) => {
		try {
			const outcome = await pickEmoji(char);
			recents.push(char);
			setRecentList(recents.list());
			setFlash(outcome === "copied" ? "Copiado" : "Insertado");
		} catch {
			setFlash("No se pudo copiar");
		}
	};

	const onKeys = usePickerKeys({
		query,
		onClearQuery: () => setQuery(""),
		onClose: closePicker,
		onSwitchTab: () => setTab(tab === "emoji" ? "clipboard" : "emoji"),
	});

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: recoge teclas y clics para la actividad y los atajos del panel
		<div
			className="flex h-screen w-screen flex-col border border-[var(--color-card-border)] bg-[var(--color-bg)] text-[var(--color-fg)]"
			onKeyDown={(e) => {
				reportActivity();
				onKeys(e);
			}}
			onClick={reportActivity}
		>
			<div role="tablist" className="flex gap-1 p-2 pb-0">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab === t.id}
						tabIndex={-1}
						onClick={() => setTab(t.id)}
						className={`rounded-[var(--radius-sharp)] px-3 py-1 text-sm ${
							tab === t.id
								? "bg-[var(--color-accent-fill)] text-[var(--color-on-accent)]"
								: "text-[var(--color-fg-muted)] hover:bg-[var(--color-card-hover)]"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>
			{tab === "emoji" ? (
				<EmojiTab
					query={query}
					onQueryChange={setQuery}
					recents={recentList}
					focusToken={focusToken}
					onPick={pick}
				/>
			) : (
				<div className="flex flex-1 items-center justify-center">
					<SoonBadge />
				</div>
			)}
			<p className="px-3 py-2 text-xs text-[var(--color-fg-muted)]">
				{flash ?? "Clic: copiar · Esc: cerrar"}
			</p>
		</div>
	);
}
