# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while in alpha, anything may change between versions).

## [Unreleased]

### Fixed

- **The dock no longer pops up when you press the capture shortcut.** The capture overlay was created without focus, Wayland flagged it as "needs attention", and docks such as Dash to Dock revealed themselves showing the Knivchit icon. The GNOME Shell extension now activates the overlay as soon as it appears. This needs the updated extension and a new login session.
- **Blank window on distributions with a newer Mesa** (seen on Fedora 44, Mesa 26): the AppImage no longer bundles its own `libwayland-*`. The bundled WebKit mixed them with the system Mesa, its web process aborted with `Could not create default EGL display: EGL_BAD_PARAMETER`, and the window stayed empty. It now uses the system libraries.

## [0.1.0-alpha.1]

First public **early preview**. It is not stable: expect rough edges and breaking changes, and back up anything you care about. Settings and data may be migrated or reset between versions.

### Included

- **Screen capture** on GNOME with Wayland, through the XDG portal, on a frozen copy of the screen.
- **Rounded or sharp selection**, movable and resizable with eight handles.
- **Annotation tools:** select, rectangle, ellipse, arrow, pen, editable text (with size and alignment), mosaic brush and eraser; six colors; undo and redo; shapes stay editable until the capture ends.
- **Outputs:** copy to the clipboard, save, save as, and pin the capture in a floating window that stays on top.
- Final image composed at **native screen resolution**.
- **Configurable global shortcut** (none by default), recorded in Settings with conflict warnings. It needs the GNOME Shell extension.
- **Main window** placed in a narrow column on the right of the screen by the extension, with dark, light and system themes.
- **GNOME Shell extension** (GPL-3.0-or-later): registers the shortcut, keeps pinned windows on top, places the main window. It captures the keyboard only while a shortcut is being recorded.
- **Installer** (`install.sh`): verifies `SHA256SUMS` before installing anything, installs the AppImage, the menu entry, the D-Bus activation and the extension, and supports `--uninstall`, `--stable` and `--version`.
- Fully local: no accounts, no telemetry, no network except the "Check for updates" button.

### Requirements

- GNOME Shell on Wayland. Tested on GNOME 50; the extension declares support for GNOME 50 only.
- Xwayland available (on by default in Fedora and Ubuntu). The AppImage starts in X11 mode and the app asks for native Wayland first.
- `fuse3` to run the AppImage (or `--appimage-extract-and-run`). For the installer: `curl`, `python3` and `sha256sum`.

### Known limitations

- The **interface is in Spanish** for now; an English interface is planned.
- **GNOME on Wayland only.** X11 sessions and other desktops are untested.
- It is an alpha: no compatibility guarantees between versions.
- Not available yet ("Coming soon", with no dates): clipboard history, OCR, translation, emoji panel and stickers.
- Release integrity relies on SHA-256 sums that travel with the files; artifact attestations are planned.

### Upgrading and migrating from ViewClip

Knivchit was called ViewClip during development; no public release was ever published under that name. If you ran a development build:

- **Data and settings:** on first start, if `~/.local/share/org.knivchit.app` has no `knivchit.db` and `~/.local/share/org.viewclip.app` exists, the app **copies** (never moves) the old data and renames the database. The old folder is left as a backup.
- **Shortcuts:** `install.sh` copies the old shortcut settings into the new schema, only for keys that are still empty.
- **Theme:** the previous theme preference is adopted once.
- **Install:** `install.sh` removes the old `viewclip@viewclip.dev` extension, desktop entry, autostart entry, D-Bus service, icons, binary and logs, keeping autostart under the new name. Log out and back in afterwards so GNOME loads the new extension.
- Updating between Knivchit versions: run `install.sh` again (add `--version <tag>` to pin one).

[Unreleased]: https://github.com/kevincharp/knivchit/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/kevincharp/knivchit/releases/tag/v0.1.0-alpha.1
