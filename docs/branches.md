# Branch flow and environments

**English** | [Español](branches.es.md)

## Branches

| Branch | Purpose | Rules |
|---|---|---|
| `main` | Stable code, always releasable | **Protected**: no direct push, only via PR with green CI and one review; no `--force` |
| `feat/<topic>` | New feature | Branches off `main`, returns to `main` by PR |
| `fix/<topic>` | Bug fix | Same |
| `docs/<topic>` | Documentation only | Same |
| `chore/<topic>` | Maintenance: dependencies, CI, tooling | Same |

Short lowercase names with hyphens: `feat/mosaic-brush`, `fix/stuck-selection`. Branches are short-lived: open them small, merge, delete. Before asking for review, bring yours up to date with `main` (`git rebase main` on an unpublished branch, or `git merge main` if already published; never rewrite published history).

## Pull requests

The project is *issues-first*: the normal way to contribute is an issue, and PRs are accepted only with a linked accepted issue or as very small fixes (full rules in [`CONTRIBUTING.md`](../CONTRIBUTING.md)).

1. Branch from `main`, one logical change, Conventional Commits.
2. Open the PR with the template filled in and `Closes #N`.
3. CI must be green; with red CI it is not reviewed. There is no promised review time.
4. It merges to `main` with the maintainer's approval. *Squash* if the branch has noisy commits; *merge* or *rebase* if each commit is clean.

## Releases

A version is published with a **`vX.Y.Z` tag** (or `vX.Y.Z-alpha.N` for a pre-release) on a `main` commit:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z   # maintainers only
```

The tag triggers `release.yml`, which reuses CI (if the gate fails there is no release), packages the AppImage and the extension, generates `SHA256SUMS` and creates the GitHub release; tags with a suffix are published as pre-releases. The installer reads the latest release. Semantic versioning; the number must match `app/src-tauri/Cargo.toml`, `app/package.json` and `extension/metadata.json`.

## Environments

| Environment | What it is | How to get it |
|---|---|---|
| **Development** | Your machine, with hot reload | `cd app && pnpm tauri dev` |
| **Candidate** | A branch's or PR's AppImage for someone else to try before merging | `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage` locally |
| **Release** | What people install | The release of a `vX.Y.Z` tag |

A bare `cargo build --release` is **not** a valid candidate: it doesn't rebuild the frontend. Always `pnpm tauri build`.
