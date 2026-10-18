<p align="center"><img src="landing/site/favicon.svg" width="96" alt="Logotipo de Knivchit"></p>

# Knivchit

[English](README.md) | **Español**

Creado por [Kevin Charpentier](https://github.com/kevincharp).

**Captura, anota y fija tu pantalla en GNOME.** Un capturador moderno para Linux sobre Wayland: selección con esquinas redondeadas, anotaciones y mosaico, y todo en local: sin cuentas, sin telemetría y sin red salvo cuando tú buscas actualizaciones.

<!-- IMAGEN: captura real del overlay con una selección y anotaciones (docs/img/overlay.png). Pendiente: no se inventa. -->
<!-- IMAGEN: captura real de la ventana principal (docs/img/ventana.png). Pendiente. -->

> Sitio web: <https://knivchit.pages.dev> · Repositorio: <https://github.com/kevincharp/knivchit>

## Estado

> **Vista previa temprana (alpha), no estable.** Pueden cambiar cosas sin compatibilidad hacia atrás, los ajustes y datos pueden migrarse o reiniciarse y habrá aristas sin pulir: haz copia de lo que te importe.

Versión **v0.1: solo el capturador**. Es lo único que existe y está probado.

| Función | Estado |
|---|---|
| Captura con selección redondeada o recta, mover y redimensionar | Disponible |
| Anotar: flecha, rectángulo, elipse, lápiz, texto, mosaico como pincel, borrador | Disponible |
| Copiar, guardar, guardar como, fijar la captura en pantalla | Disponible |
| Atajo propio configurable, temas oscuro / claro / sistema | Disponible |
| Historial de portapapeles | **Pronto** |
| OCR (texto de la pantalla) y traducción | **Pronto** |
| Selector de emojis y stickers | **Pronto** |

Probado en **GNOME 50 sobre Wayland**. La extensión declara compatibilidad solo con GNOME 50.

## ¿Por qué otra herramienta de capturas?

Hay buenas herramientas de captura para Linux, y Knivchit no dice hacer algo que ellas no puedan.

- **Flameshot** es madura, muy usada y funciona en GNOME.
- **Waytator** añade edición de video y OCR, y apunta primero a compositores wlroots.
- **Spectacle** es la de KDE.

Knivchit es una apuesta más pequeña:

- **GNOME primero:** una extensión del Shell se ocupa del atajo global y de colocar las ventanas, porque Wayland no deja que una app lo haga sola.
- **Una sola app para las herramientas pequeñas alrededor de una captura:** hoy captura y anota; el historial del portapapeles, un selector de emojis, OCR y traducción están planeados, sin fechas.
- **Local por diseño:** sin cuentas ni telemetría; su única petición de red es el botón opcional de «buscar actualizaciones».
- **Un diseño moderno como objetivo,** no solo una lista de funciones.

Es una alpha: si alguna de las anteriores ya hace lo que necesitas, úsala. Lo que esta sección dice de otras herramientas sale de sus README a octubre de 2026; avísanos si algo quedó desactualizado.

## Requisitos

- GNOME Shell sobre **Wayland** (no se ha probado X11 ni otros escritorios).
- **Xwayland** (activo por defecto en Fedora y Ubuntu): el AppImage arranca con `GDK_BACKEND=x11` y, en sesiones Wayland, la app lo cambia a `wayland,x11`; Xwayland queda como respaldo.
- Para compilar: Node 24, pnpm 12.4.1, Rust estable ≥ 1.77.2 y las dependencias de sistema de Tauri v2 (WebKitGTK 4.1, etc.).

## Instalación

Instalador (descarga el release más reciente y **verifica su SHA-256 contra `SHA256SUMS` antes de tocar nada**). Se baja primero y se ejecuta después, para poder leerlo:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/kevincharp/knivchit/main/install.sh -o install.sh
less install.sh            # léelo
bash install.sh
```

`install.sh` está en la raíz del repositorio. Instala el AppImage en `~/.local/bin`, la entrada del menú, la activación por D-Bus y la extensión de GNOME Shell. Después **cierra la sesión y vuelve a entrar** (en Wayland GNOME no recarga extensiones en caliente) y asigna tu atajo en Configuración. Para desinstalar: `install.sh --uninstall` (no borra tus capturas ni tus datos). Si Knivchit está abierto, el instalador pregunta antes de cerrarlo (o usa `--close-app` para cerrarlo sin preguntar); nunca toca otros procesos.

Mientras no haya versiones estables, `install.sh` instala el release más reciente **aunque sea un pre-release** y lo avisa antes de seguir («instalando PRE-RELEASE v0.1.0-alpha.4»). Con `bash install.sh --stable` exige una versión estable (falla si solo hay pre-releases) y con `bash install.sh --version v0.1.0-alpha.4` fijas una versión concreta. Para probar un candidato local sin red: `bash install.sh --from-dir <carpeta con el AppImage, el zip de la extensión y SHA256SUMS>`.

A mano:

1. Descarga del release que quieras (`https://github.com/kevincharp/knivchit/releases`; mientras sean pre-releases, no aparecen como «Latest») el AppImage, la extensión y `SHA256SUMS`, y comprueba las sumas: `sha256sum -c SHA256SUMS`.
2. `chmod +x` al AppImage y ejecútalo donde quieras.
3. Instala la extensión: `gnome-extensions install --force <archivo.zip>`, cierra sesión y vuelve a entrar, y actívala con `gnome-extensions enable <uuid>` (el UUID está en `extension/metadata.json`).

Sin la extensión el capturador funciona desde el botón de la ventana principal, pero no hay atajo global ni se mantienen encima las capturas fijadas.

## Problemas conocidos

- Si la ventana se comporta raro (posición, escala, foco), prueba a forzar el backend: `GDK_BACKEND=wayland ./Knivchit.AppImage`. La app solo reemplaza el valor `x11` que pone el AppImage; cualquier otro que definas se respeta.

## Atajos

**No hay ningún atajo por defecto**: lo grabas tú en *Configuración* de la app y te avisa si choca con uno de GNOME. La extensión lo registra en el Shell y lanza la captura por D-Bus.

Dentro del overlay: arrastra para seleccionar, mueve o redimensiona con las ocho manijas, elige herramienta en la barra y termina copiando, guardando o fijando. `Esc` cancela.

## Cómo compilar

```sh
cd app && pnpm install --frozen-lockfile
pnpm tauri dev                                   # desarrollo (app + frontend)
APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1 pnpm tauri build --bundles appimage   # AppImage
```

`cargo build --release` por sí solo **no** produce un binario utilizable (no reconstruye el frontend). Las dos variables de entorno evitan fallos reales en máquinas sin `libfuse.so.2` o con un `ld` moderno que emite `.relr.dyn`.

## Cómo probar

El *gate* que debe pasar antes de dar nada por terminado:

```sh
cd app && pnpm exec tsc --noEmit && pnpm exec biome check . \
  && cargo test --manifest-path src-tauri/Cargo.toml && pnpm exec vitest run
```

La extensión se prueba aparte, con un bus D-Bus privado: `dbus-run-session -- gjs -m extension/tests/clipboardService.test.js` (y el resto de `extension/tests/`). El sitio, con `node landing/scripts/check.mjs`.

## Arquitectura en breve

Dos piezas con stacks distintos, a propósito:

- **`app/`** — Tauri v2 (Rust) + React: es el producto entero (capturador, anotador, ajustes). El frontend compone la imagen final y el backend solo valida, guarda, copia y fija.
- **`extension/`** — extensión de GNOME Shell (GJS): hace lo que en Wayland solo puede hacer el compositor (atajo global, colocar la ventana, mantener encima las fijadas). Sin interfaz ni lógica de negocio.

Se hablan por D-Bus. Más detalle en [`docs/architecture.es.md`](docs/architecture.es.md).

## Aviso sobre IA

Knivchit lo construye un mantenedor humano que usa asistentes de IA para programar como herramienta de desarrollo. El mantenedor decide qué se construye, prueba cada versión a mano y se hace responsable de lo que se publica. La aplicación en sí no contiene IA ni hace peticiones a servicios de IA; su única petición de red es el botón opcional de «buscar actualizaciones», que consulta la API de GitHub.

Los informes de errores y los PR son bienvenidos hayan usado o no herramientas de IA, y todo lo que se fusiona lo revisa el mantenedor. Mira [Sobre el uso de IA](CONTRIBUTING.es.md#sobre-el-uso-de-ia).

## Contribuir

Lee [`CONTRIBUTING.es.md`](CONTRIBUTING.es.md), el flujo de ramas en [`docs/branches.es.md`](docs/branches.es.md) y el [código de conducta](CODE_OF_CONDUCT.es.md). Vulnerabilidades: [`SECURITY.es.md`](SECURITY.es.md), nunca en un issue público.

## Licencias

- `app/`: **MIT** ([`app/LICENSE`](app/LICENSE)).
- `extension/`: **GPL-3.0-or-later** ([`extension/LICENSE`](extension/LICENSE)), porque corre dentro de GNOME Shell.
- Fuentes del sitio (Inter, Bricolage Grotesque): SIL OFL 1.1.
- `landing/`, `docs/` y el resto: **MIT** (© 2026 Kevin Charpentier) (ver [`LICENSE`](LICENSE)).
