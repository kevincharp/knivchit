# Contributing

**English** | [Español](CONTRIBUTING.es.md)

Thanks for wanting to help. The project is **issues-first**: it has a single maintainer with little time to review code, so the normal way to contribute is an issue, not a pull request. It is an early preview (alpha), so breaking changes can happen.

## 1. Open an issue

Use the **bug** or **feature** template. The maintainer fixes it. The better the report (version, GNOME, steps, logs without private data), the sooner it gets fixed.

- A security bug does **not** go in an issue: see [`SECURITY.md`](SECURITY.md).
- By taking part you accept the [code of conduct](CODE_OF_CONDUCT.md).
- Issues without a reply are closed for inactivity (automated).

## 2. When a pull request is accepted

Only in two cases:

1. **There is a prior issue approved** by the maintainer (label `accepted` or `help-wanted`) and the PR links it with `Closes #N`.
2. It is a **very small, self-contained fix**: a typo, a docs change, or an obvious bug of a few lines.

Large PRs, refactors, new features and new dependencies **without an accepted issue are closed unreviewed**. It is nothing personal; it is the only way the project keeps moving.

**Timing:** there is no promise of a fast review. CI is the first filter, and a PR with failing CI is not reviewed. CI runs the gate on every PR, and a check verifies that the title is a Conventional Commit and that the PR links an issue.

## 3. What a good PR looks like

- **One PR = one small logical change**, with no unrelated files or mass reformatting.
- With tests (a bug is fixed with a test that reproduces it).
- With the **gate green**, from `app/`:

```sh
pnpm exec tsc --noEmit && pnpm exec biome check . \
  && cargo test --manifest-path src-tauri/Cargo.toml && pnpm exec vitest run
```

  If you touch `extension/`: `dbus-run-session -- gjs -m extension/tests/<file>.test.js`. If you touch `landing/`: `node landing/scripts/check.mjs`.
- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`), e.g. `fix(capture): selection no longer sticks when released outside the window`. If you add a dependency, say in the commit why what is already installed isn't enough.
- A branch from `main` with a `feat/`, `fix/`, `docs/` or `chore/` prefix ([`docs/branches.md`](docs/branches.md)) and the PR template filled in.

### About using AI

You may use it. But whoever sends the PR must **understand and have tested** what they send, and be able to defend it in review. A PR generated without review is closed.

## Set up the environment

Node 24, pnpm 12.4.1 (`corepack prepare pnpm@12.4.1 --activate`), Rust stable ≥ 1.77.2, Tauri v2's system dependencies and, for the extension, `gjs` and `dbus-run-session`.

```sh
git clone https://github.com/kevincharp/knivchit
cd app && pnpm install --frozen-lockfile
pnpm tauri dev
```

Exact versions are in the lockfiles; read them, don't guess. Useful commands:

| Task | Command |
|---|---|
| Typecheck | `cd app && pnpm exec tsc --noEmit` |
| Lint / format | `cd app && pnpm exec biome check .` · `pnpm exec biome check --write .` |
| Frontend tests | `cd app && pnpm exec vitest run` (one file: `pnpm exec vitest run <path>`) |
| Rust tests | `cargo test --manifest-path app/src-tauri/Cargo.toml` (filter by name: add `<filter>`) |
| Extension tests | `dbus-run-session -- gjs -m extension/tests/<file>.test.js` (use `dbus-run-session`, not `dbus-launch`) |
| Runnable AppImage | `cd app && APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage` |

A plain `cargo build --release` is only a compile check: its binary doesn't rebuild the frontend and won't run properly. Your contribution is published under the license of the folder you touch ([`LICENSE`](LICENSE)).

## Rules that are not negotiable

1. No remote content in the webview while Tauri commands are exposed (it would be remote code execution with filesystem permissions).
2. Clipboard content is never written to any log, and never sent over the session D-Bus (it travels over a private socketpair).
3. No secrets, `.env` files or build output (`dist/`, `target/`) in commits.
4. An applied SQLite migration is never edited: write a new one. SQL is always parameterized.
5. The UI calls Tauri only through `app/src/lib/tauri.ts`, and every Tauri command validates its arguments before touching the database.
6. `extension/` has no UI and no business logic: it listens, places windows and exposes D-Bus; it must not import `Shell`, `Meta` or `Main` from `extension/lib/`.
7. Colors and radii come from the design tokens in `app/src/styles/theme.css`, never loose hex values. The wood color is for the brand only, never for interface.
8. Every surface that receives mouse gestures (overlay, pin) blocks WebKit's native drag (`.capture-surface` class and the `useNativeDragGuard` hook).
9. A task is not done with the gate red.

Telemetry, accounts, cloud services or network access not requested by the user don't fit the project.
