# Flujo de ramas y ambientes

[English](branches.md) | **Español**

## Ramas

| Rama | Para qué | Reglas |
|---|---|---|
| `main` | Código estable, siempre releasable | **Protegida**: sin push directo, solo por PR con CI en verde y una revisión; sin `--force` |
| `feat/<tema>` | Función nueva | Sale de `main`, vuelve a `main` por PR |
| `fix/<tema>` | Corrección de un error | Ídem |
| `docs/<tema>` | Solo documentación | Ídem |
| `chore/<tema>` | Mantenimiento: dependencias, CI, herramientas | Ídem |

Nombres cortos, en minúsculas y con guiones: `feat/mosaico-pincel`, `fix/seleccion-pegada`. Las ramas viven poco: se abren pequeñas, se mezclan y se borran. Antes de pedir revisión, ponla al día con `main` (`git rebase main` en tu rama aún no publicada, o `git merge main` si ya la publicaste; nunca reescribas historial publicado).

## Pull requests

El proyecto es *issues-first*: la vía normal es abrir un issue, y los PR solo se aceptan con un issue aceptado enlazado o si son un arreglo muy pequeño (reglas completas en [`CONTRIBUTING.es.md`](../CONTRIBUTING.es.md)).

1. Rama desde `main`, un solo cambio lógico, commits en Conventional Commits en español.
2. PR con la plantilla rellena y `Closes #N`.
3. La CI debe estar en verde; con la CI en rojo no se revisa. No hay garantía de plazo de revisión.
4. Se mezcla a `main` con la aprobación del mantenedor. *Squash* si hay commits de ruido; *merge* o *rebase* si cada commit es limpio.

## Releases

Una versión se publica con una **etiqueta `vX.Y.Z`** (o `vX.Y.Z-alpha.N` para un pre-release) sobre un commit de `main`:

```sh
git tag vX.Y.Z && git push origin vX.Y.Z   # solo los mantenedores
```

La etiqueta dispara `release.yml`, que reutiliza la CI (si el gate falla, no hay release), empaqueta el AppImage y la extensión, genera `SHA256SUMS` y crea el release en GitHub; las etiquetas con sufijo se publican como pre-release. El instalador lee siempre el último release. Versionado semántico; el número debe coincidir con `app/src-tauri/Cargo.toml`, `app/package.json` y `extension/metadata.json`.

## Ambientes

| Ambiente | Qué es | Cómo se obtiene |
|---|---|---|
| **Desarrollo** | Tu máquina, con recarga en caliente | `cd app && pnpm tauri dev` |
| **Candidato** | El AppImage de una rama o PR para que otra persona lo pruebe antes de mezclar | `APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage` en local |
| **Release** | Lo que instala la gente | El release de una etiqueta `vX.Y.Z` |

Un `cargo build --release` suelto **no** sirve de candidato: no reconstruye el frontend. Siempre `pnpm tauri build`.

