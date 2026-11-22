# Knivchit

Capturador de pantalla moderno y panel flotante de emojis y portapapeles para
GNOME (Linux). Tauri v2 (Rust) + React, con una extensión de GNOME Shell (GJS)
como puente con el compositor. Sin servidor, sin backend, sin cuentas.

## Cómo correr y probar

| Tarea | Comando |
|---|---|
| Instalar dependencias | `cd app && pnpm install --frozen-lockfile` |
| Desarrollo (shell + frontend) | `cd app && pnpm tauri dev` |
| Empaquetar AppImage | `cd app && APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage` |
| Typecheck | `cd app && pnpm exec tsc --noEmit` |
| Lint y formato | `cd app && pnpm exec biome check .` (`--write` para corregir) |
| Tests del frontend | `cd app && pnpm exec vitest run [archivo]` |
| Tests de Rust | `cargo test --manifest-path app/src-tauri/Cargo.toml [filtro]` |
| Tests de la extensión | `GIO_USE_VFS=local dbus-run-session -- gjs -m extension/tests/<archivo>.test.js` |
| Comentarios | `node scripts/check-comments.mjs` (pruebas: `node --test scripts/check-comments.test.mjs`) |

`cargo build --release` solo comprueba que compila: el binario no sirve para
probar la app (no reconstruye el frontend y queda apuntando a `localhost:1420`).
Para un ejecutable usar `pnpm tauri build`.

**Gate** (debe pasar antes de dar algo por terminado):

```sh
cd app && pnpm exec tsc --noEmit && pnpm exec biome check . \
  && cargo test --manifest-path src-tauri/Cargo.toml && pnpm exec vitest run
cd .. && node scripts/check-comments.mjs
```

Si el cambio toca `extension/`, correr además todos sus tests con
`dbus-run-session`.

Toolchain: Node 24 LTS, pnpm 12.4.1 (`corepack prepare pnpm@12.4.1 --activate`),
Rust stable ≥ 1.77.2. Las versiones de cada dependencia están en los lockfiles.

## Stack

Tauri v2 (Rust) · React 19 + TypeScript + Vite 8 · Tailwind CSS v4 (config
CSS-first) · SQLite embebida vía `tauri-plugin-sql` · GJS puro para la extensión.

## Arquitectura

Dos componentes con stacks distintos, a propósito (detalle en
`docs/architecture.md`):

- **`app/`** es el producto: capturador, anotador, panel flotante, ajustes.
- **`extension/`** hace solo lo que únicamente el compositor puede: escuchar el
  portapapeles dentro del proceso de GNOME Shell, registrar atajos globales,
  colocar las ventanas flotantes, mostrar el icono opcional de la barra e
  insertar texto en la app enfocada. **Nunca lleva UI ni lógica de negocio.**

Captura: atajo global → D-Bus `org.knivchit.App.StartCapture` →
`commands/capture_flow.rs` → portal XDG (`interactive(false)`) → ventana
`capture-overlay` con la foto congelada → el **frontend compone el PNG final**
(recorte a resolución nativa y anotaciones, en píxeles de la imagen) y lo envía
a `save_capture`, `copy_capture` o `pin_capture`. El backend solo valida,
guarda, copia y fija.

El contenido del portapapeles y el texto de `InsertText` viajan por un
`socketpair` privado (descriptor pasado por D-Bus), nunca por el bus de sesión,
que no es confidencial.

Las ventanas las coloca la extensión, no la app: bajo Wayland una aplicación no
puede posicionarse sola.

### Límites entre capas

| Capa | Puede importar de | Nunca |
|---|---|---|
| `app/src/components/**` | `app/src/lib/tauri.ts` | Llamar `invoke()` directo |
| `app/src-tauri/src/dbus/**` | `app/src-tauri/src/db/` | Nada del frontend |
| `app/src-tauri/src/db/**` | nada interno | Ser abierto desde fuera de `db/` |
| `extension/extension.js` | `extension/lib/*` | Ser importado por `extension/lib/` |
| `extension/lib/**` | GJS estándar, `gi://Gio` | `gi://Shell`, `gi://Meta`, `Main` (rompe los tests con `gjs` a secas) |

### Fuente única de verdad

| Concepto | Dónde |
|---|---|
| Esquema SQLite | `app/src-tauri/src/db/migrations.rs` (nunca editar una migración ya aplicada: crear otra) |
| Contrato D-Bus | `app/src-tauri/src/dbus/mod.rs` + `extension/lib/clipboardService.js`; cambiar una firma exige tocar los dos lados en el mismo commit |
| Tokens de diseño | `app/src/styles/theme.css` |
| Comandos Tauri | `app/src-tauri/src/commands/mod.rs`, cada uno registrado explícitamente |

## Reglas de código

1. Un componente por archivo; si pasa de ~300 líneas, dividirlo por responsabilidad.
2. `invoke()` solo desde `app/src/lib/tauri.ts`.
3. SQL siempre parametrizado, nunca por concatenación.
4. Cada comando Tauri valida sus argumentos antes de tocar SQLite.
5. El hook de pánico nunca escribe contenido del portapapeles al log: solo
   metadata del error.
6. Dependencia nueva: solo con la razón en el mensaje del commit y tras
   comprobar que ni la stdlib ni algo ya instalado lo resuelve.
7. Toda superficie con gestos de ratón (overlay, pin) bloquea el arrastre nativo
   de WebKit: clase `.capture-surface` y hook `useNativeDragGuard`. No basta
   `draggable={false}`. No diagnosticar como «problema de GPU» sin descartarlo.
8. Comentarios cortos que explican el porqué no obvio (1–3 líneas); sin historia
   de intentos, sin código desactivado. Lo comprueba `scripts/check-comments.mjs`.

## No negociable

1. Nunca cargar contenido remoto en el webview mientras haya comandos Tauri
   expuestos.
2. Nunca escribir contenido del portapapeles a ningún log.
3. Nunca commitear secretos, `.env` ni salida de build (`dist/`, `target/`).
4. Nunca editar una migración de SQLite ya aplicada.
5. Nunca dar una tarea por terminada con el gate en rojo.
6. `extension/` no importa lógica de negocio ni UI.
7. El contenido del portapapeles y `InsertText` nunca van por el bus de sesión.

## Diseño

Tokens semánticos en `app/src/styles/theme.css`; los componentes no usan colores
fijos. Hay tema oscuro y claro (Sistema, Oscuro, Claro) en la ventana principal;
el overlay y el pin se quedan siempre oscuros.

- **Acento:** `--color-accent` es la marca (bordes, manijas, foco), nunca el
  relleno de algo con texto blanco. Los rellenos con texto usan
  `--color-accent-fill`; el acento como texto, `--color-accent-ink`. La prueba
  `lib/theme.contrast.test.ts` exige 4,5:1.
- **Marca:** la madera (`--color-brand-wood`) es solo del logo, nunca de la interfaz.
- **Tipo:** Inter con respaldo `system-ui`.
- **Movimiento:** 150–200 ms, `ease-out`, solo `opacity` y `transform`; respeta
  `prefers-reduced-motion`.
- **Sin sombras.** Las superficies flotantes estáticas usan `backdrop-filter`;
  las que se reposicionan en vivo (toolbar, opciones, etiqueta de dimensiones)
  **no**: WebKitGTK compone por software y parpadea.

## Ramas y ambientes

- `main` es producción y está protegida. Cada cambio va en una rama corta
  `tipo/descripcion` que vuelve por PR (ver `docs/branches.md`).
- Commits en español, Conventional Commits, una línea.
- Versiones: etiqueta `vX.Y.Z[-alpha.N]` sobre `main`; la dispara `release.yml`.
  El número debe coincidir en `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`,
  `app/package.json` y `extension/metadata.json`.
- No hay ambiente bajo: se prueba en local con `pnpm tauri dev`.

## Definición de hecho

1. Cumple los criterios de aceptación del ticket.
2. El gate pasa.
3. El cambio quedó simplificado.
4. Está commiteado.

## Errores repetidos

(vacío)

## Fuera de alcance

Sin servidor, cuentas ni sincronización en la nube. Solo GNOME bajo Wayland.

## Dónde va cada cosa

- `README.md`, `docs/` y este archivo: para quien lee el repo. Se publican.
- `STATUS.local.md`: estado actual; leerlo entero al empezar la sesión.
- Especificaciones y planes: `*.local.md`, nunca en `docs/` ni commiteados.
- `CLAUDE.local.md`: reglas privadas del autor; no se publica.
