# Contribuir

[English](CONTRIBUTING.md) | **Español**

Gracias por querer ayudar. El proyecto es **issues-first**: lo mantiene una sola persona con poco tiempo para revisar código, así que la vía normal de aportar es un issue, no un PR. El proyecto está en vista previa temprana (alpha): pueden producirse cambios incompatibles.

## 1. Abre un issue

Usa la plantilla de **bug** o de **función**. El mantenedor lo corrige. Cuanto mejor el informe (versión, GNOME, pasos, registros sin datos privados), antes se arregla.

- Un bug de seguridad **no** va en un issue: ver [`SECURITY.es.md`](SECURITY.es.md).
- Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.es.md).
- Los issues sin respuesta se cierran por inactividad (lo hace una automatización).

## 2. Cuándo se acepta un PR

Solo en dos casos:

1. **Hay un issue previo aprobado** por el mantenedor (etiqueta `accepted` o `help-wanted`) y el PR lo enlaza con `Closes #N`.
2. Es un **arreglo muy pequeño y acotado**: un typo, un cambio de documentación o un bug evidente de pocas líneas.

Los PR grandes, los refactors, las funciones nuevas y las dependencias nuevas **sin issue aceptado se cierran sin revisar**. No es nada personal: es la única forma de que el proyecto avance.

**Tiempos:** no hay garantía de revisión rápida. La CI es el primer filtro, y un PR con la CI en rojo no se revisa. La CI corre el gate en cada PR, y una comprobación verifica que el título sea Conventional Commits y que el PR enlace un issue.

## 3. Cómo debe ser un PR

- **Un PR = un cambio lógico, pequeño**, sin archivos ajenos ni cambios de formato masivos.
- Con tests (un bug se arregla con un test que lo reproduce).
- Con el **gate en verde**, desde `app/`:

```sh
pnpm exec tsc --noEmit && pnpm exec biome check . \
  && cargo test --manifest-path src-tauri/Cargo.toml && pnpm exec vitest run
```

  Si tocas `extension/`: `dbus-run-session -- gjs -m extension/tests/<archivo>.test.js`. Si tocas `landing/`: `node landing/scripts/check.mjs`.
- [Conventional Commits](https://www.conventionalcommits.org/) **en español**: `tipo(ámbito): descripción` (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`), p. ej. `fix(captura): la selección ya no se queda pegada`. Si añades una dependencia, di en el commit por qué lo ya instalado no basta.
- Rama desde `main` con prefijo `feat/`, `fix/`, `docs/` o `chore/` ([`docs/branches.es.md`](docs/branches.es.md)) y la plantilla del PR rellena.

### Sobre el uso de IA

Puedes usarla. Pero quien envía el PR debe **entender y haber probado** lo que envía, y poder defenderlo en la revisión. Un PR generado sin revisar se cierra.

## Montar el entorno

Node 24, pnpm 12.4.1 (`corepack prepare pnpm@12.4.1 --activate`), Rust estable ≥ 1.77.2, las dependencias de sistema de Tauri v2 y, para la extensión, `gjs` y `dbus-run-session`.

```sh
git clone https://github.com/kevincharp/knivchit
cd app && pnpm install --frozen-lockfile
pnpm tauri dev
```

Las versiones exactas están en los lockfiles; léelos, no las supongas. Comandos útiles:

| Tarea | Comando |
|---|---|
| Typecheck | `cd app && pnpm exec tsc --noEmit` |
| Lint / formato | `cd app && pnpm exec biome check .` · `pnpm exec biome check --write .` |
| Tests del frontend | `cd app && pnpm exec vitest run` (un archivo: `pnpm exec vitest run <ruta>`) |
| Tests de Rust | `cargo test --manifest-path app/src-tauri/Cargo.toml` (filtrar por nombre: añade `<filtro>`) |
| Tests de la extensión | `dbus-run-session -- gjs -m extension/tests/<archivo>.test.js` (usa `dbus-run-session`, no `dbus-launch`) |
| AppImage ejecutable | `cd app && APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage` |

Un `cargo build --release` suelto solo comprueba que compila: su binario no reconstruye el frontend y no sirve para probar. Tu aportación se publica bajo la licencia de la carpeta que toques ([`LICENSE`](LICENSE)).

## Reglas que no se negocian

1. Nada de contenido remoto en el webview mientras haya comandos Tauri expuestos (sería ejecución remota de código con permisos de filesystem).
2. El contenido del portapapeles nunca se escribe en un log ni viaja por el D-Bus de sesión (va por un `socketpair` privado).
3. Sin secretos, `.env` ni salidas de build (`dist/`, `target/`) en los commits.
4. Una migración de SQLite ya aplicada no se edita: se escribe una nueva. El SQL va siempre parametrizado.
5. La UI llama a Tauri solo por `app/src/lib/tauri.ts`, y cada comando de Tauri valida sus argumentos antes de tocar la base de datos.
6. `extension/` no lleva interfaz ni lógica de negocio: escucha, coloca ventanas y expone D-Bus; `extension/lib/` no importa `Shell`, `Meta` ni `Main`.
7. Colores y radios salen de los tokens de `app/src/styles/theme.css`, nunca hex sueltos. El color madera es solo de la marca, no de la interfaz.
8. Toda superficie que reciba gestos de ratón (overlay, pin) bloquea el arrastre nativo de WebKit (clase `.capture-surface` y el hook `useNativeDragGuard`).
9. Una tarea no está terminada con el gate en rojo.

Telemetría, cuentas, servicios en la nube o red no pedida por el usuario no encajan en el proyecto.
