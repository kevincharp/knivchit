# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/) (while in alpha, anything may change between versions).

## [Unreleased]

## [0.1.0-alpha.4]

Fixes the About page, which still said the repository was not public yet. To update, run `install.sh` again and log out and back in.

### Fixed

- **Installer and uninstaller with Knivchit running:** `install.sh` (install, update and `--uninstall`) no longer replaces or removes files under a running Knivchit. In a terminal it asks whether to close it; without one it refuses and changes nothing. `--close-app` closes it without asking. Only processes of this installation are touched.
- **About page:** the "public repository" card no longer says the code will be published later. It now shows the repository address (the app cannot open external links, so it is plain, selectable text).
- **Update message:** when a newer version exists, it now explains how to update (run `install.sh` again, then log out and back in).
- **Version format:** the new version is shown without the tag's leading `v`, the same way as the installed one.

## [0.1.0-alpha.3]

Two fixes for problems found while using alpha.2. To update, run `install.sh` again and log out and back in.

### Fixed

- **The default screenshots folder now follows your system language.** It used to be hardcoded to `~/Pictures/Screenshots`, so a Spanish system got a new English-named `Pictures` folder. The default is now GNOME's own screenshots folder inside your Pictures directory, with its translated name (for example `~/Imágenes/Capturas de pantalla`). If you already confirmed the old default, pick the folder again once in Settings.
- **"Open folder" in Settings opened a web browser instead of the file manager.** Inside the AppImage the helper process inherited the AppImage's own library and search paths, `gio` failed and `xdg-open` fell back to `$BROWSER`. It now runs with the system's environment.

## [0.1.0-alpha.2]

Fixes two problems found in the first real install of alpha.1. If you installed alpha.1, run `install.sh` again to update and then log out and back in.

### Fixed

- **The dock no longer pops up when you press the capture shortcut.** The capture overlay was created without focus, Wayland flagged it as "needs attention", and docks such as Dash to Dock revealed themselves showing the Knivchit icon. The GNOME Shell extension now activates the overlay as soon as it appears. This needs the updated extension and a new login session.
- **Blank window on distributions with a newer Mesa** (seen on Fedora 44, Mesa 26): the AppImage no longer bundles its own `libwayland-*`. The bundled WebKit mixed them with the system Mesa, its web process aborted with `Could not create default EGL display: EGL_BAD_PARAMETER`, and the window stayed empty. It now uses the system libraries.

### Changed

- Dependency updates (Tauri 2.12, `tauri-plugin-opener`, `tauri-plugin-sql`, `tokio`, `uuid`, Biome and other minor and patch releases) and `pnpm/action-setup` in the release workflow.

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

[Unreleased]: https://github.com/kevincharp/knivchit/compare/v0.1.0-alpha.4...HEAD
[0.1.0-alpha.4]: https://github.com/kevincharp/knivchit/compare/v0.1.0-alpha.3...v0.1.0-alpha.4
[0.1.0-alpha.3]: https://github.com/kevincharp/knivchit/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/kevincharp/knivchit/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/kevincharp/knivchit/releases/tag/v0.1.0-alpha.1
