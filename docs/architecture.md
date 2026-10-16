# Architecture

**English** | [Español](architecture.es.md)

The app is **local**: no server, no accounts, no telemetry. Two pieces with different stacks, on purpose.

```
 global shortcut ──► extension/ (GJS, inside GNOME Shell)
                       │  session D-Bus
                       ▼
                     app/ (Tauri v2: Rust + React)
                       ├─ Rust backend: validates, saves, copies, pins
                       └─ web frontend: overlay, annotator, main window
```

## Why two parts

On GNOME with Wayland an application cannot register global shortcuts, place its own window or keep another one on top. Only the compositor can, and the one legitimate route is a **GNOME Shell extension**, which runs in its process and must be GJS. Everything else lives in `app/`, which has no such restriction.

## `app/`: the product

- **Backend (`app/src-tauri/`)**, Rust: Tauri commands, capture through the XDG portal, saving, copying to the clipboard, pinned windows, settings and the SQLite database. Every command validates its arguments before touching data.
- **Frontend (`app/src/`)**, React 19 + TypeScript + Tailwind v4: the capture overlay, the annotator, the main window and settings. It **composes the final image** (a crop at native resolution plus the annotations, in image pixels) and sends it to the backend. The UI talks to Rust only through `app/src/lib/tauri.ts`.
- **Design:** the tokens (colors, radii, typography) live in `app/src/styles/theme.css`, with dark and light themes. The wood color belongs to the brand only.

### Database (SQLite)

- Embedded SQLite through `tauri-plugin-sql`. Only `app/src-tauri/src/db/mod.rs` opens the connection; no command or test opens its own against the real file.
- The schema lives only in `app/src-tauri/src/db/migrations.rs`. A new migration gets the next version number; **an applied migration is never edited**, fixes go forward in a new one. SQL is always parameterized.
- `settings` is a single row (`id = 1`, enforced by a `CHECK`): every write is an `UPDATE`. History and screenshot tables use hard delete.
- Tests run against `:memory:`, never a file shared between tests.

## `extension/`: the bridge to the Shell

A GNOME Shell extension in plain GJS. It does only what the compositor requires: registering the global shortcut, recording key combinations, placing the main window on the right of the screen and keeping pinned captures on top. No UI and no business logic. Its pure logic lives in `extension/lib/` (no `Shell`, `Meta` or `Main`), so it can be tested with bare `gjs`.

## How they talk: D-Bus

Two names on the session bus; they only change together on both sides:

- `org.knivchit.App`, exposed by the **app** (via `zbus`): `StartCapture` and `ShowMain` take no arguments and return nothing. `TogglePopup` is reserved for a future feature. The app checks who is calling: `ShowMain` and `StartCapture` accept only callers of the same user whose executable is `gnome-shell` (which must be owned by root and not writable by anyone else) or, for `ShowMain` only, another Knivchit process; other session processes are refused with `org.freedesktop.DBus.Error.AccessDenied`, as is any caller that cannot be verified. The executable is identified by name, so any process of the same user that is called `knivchit` can still ask the app to show its window; it cannot start a capture.
- `org.knivchit.ClipboardService`, exposed by the **extension**: shortcut management (`GetShortcuts`, `SetShortcut`, `CheckConflicts`, `RecordShortcut`). It serves only the app (same UID and PID as the owner of `org.knivchit.App`); anyone else gets `AccessDenied`. Reserved or invalid accelerators (such as `Alt+F4` or `Super+L`) are rejected. `RecordShortcut` grabs the keyboard only for the recording, always releases it, and refuses to run with the session locked.

The session bus is **not confidential** against other processes of the same user, so anything sensitive (clipboard contents, text to insert) never travels over it: it uses a private socketpair whose descriptor is passed over D-Bus. Tests that exercise this contract run on a **private** bus (`dbus-run-session`), never the real session bus. Changing a signature means touching both sides in the same commit.

## Anatomy of a capture

1. The user presses their shortcut → the extension calls `StartCapture` on the app (or they click the main window's button).
2. The app hides its window and asks the XDG portal for the full screen (no native picker).
3. It opens the full-screen overlay over that frozen photo.
4. The user draws the selection, moves or resizes it, and annotates from the toolbar.
5. The frontend composes the final PNG and sends it to Rust, which **saves**, **copies** or **pins** it in a floating window.

## Module boundaries

| Layer | May import from | Never |
|---|---|---|
| `app/src/components/**` | `app/src/lib/tauri.ts` | call `invoke()` directly |
| `app/src-tauri/src/dbus/**` | `app/src-tauri/src/db/` | anything from the frontend |
| `app/src-tauri/src/db/**` | nothing internal | be opened from outside `db/` |
| `extension/extension.js` | `extension/lib/` | be imported by `extension/lib/` |
| `extension/lib/**` | standard GJS, `gi://Gio` | `gi://Shell`, `gi://Meta`, `Main` |

## Outside the app

- **`landing/`**: the static promotional site (`landing/site/` is what gets deployed). It is not part of the app build. See [`landing/README.md`](../landing/README.md).
- **`install.sh`**: the release installer (verifies `SHA256SUMS`).
- **`.github/workflows/`**: CI (the gate) and tag-based releases. See [`branches.md`](branches.md).

More detail: [`extension/README.md`](../extension/README.md), [`app/README.md`](../app/README.md) and [`CONTRIBUTING.md`](../CONTRIBUTING.md) (commands and rules).
