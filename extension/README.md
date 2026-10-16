# extension/

Extensión de GNOME Shell (GJS) de Knivchit, publicada como **Knivchit Shortcuts**
(`knivchit@knivchit.dev`; el dominio del uuid es provisional). Complementa a la aplicación
(`../app/`): hace lo que bajo Mutter/Wayland solo puede hacer el compositor. No tiene
interfaz propia ni lógica de negocio; eso es trabajo de `../app/`. Visión de conjunto en
[`../docs/arquitectura.md`](../docs/arquitectura.md).

## Qué hace

- **Atajo global de captura.** Liga el atajo que el usuario elige en los Ajustes de la app y,
  al pulsarlo, llama a `org.knivchit.App.StartCapture` por D-Bus. **No hay ningún atajo por
  defecto**: el esquema viene vacío. Si la app no responde, reintenta una vez y avisa con una
  notificación discreta. Se liga solo en uso normal y vista general (no en la pantalla de
  bloqueo) y no actúa con la sesión bloqueada.
- **Gestión de los atajos por D-Bus** (`org.knivchit.ClipboardService`, ver «Contrato D-Bus»).
  `RecordShortcut` graba una combinación con el teclado capturado por el Shell, para poder
  grabar incluso las que Mutter ya tiene ligadas.
- **Icono opcional en la barra superior.** Un botón sin menú con `icons/knivchit-symbolic.svg`
  (se recolorea con el tema del panel): un clic, o Enter/Espacio con foco, llama a
  `org.knivchit.App.ShowMain` y activa la ventana principal cuando aparece. Se activa o desactiva
  en Ajustes (clave `show-panel-icon`, activada por defecto) y el cambio se aplica en vivo. Como un icono de bandeja, solo está visible mientras la app está en marcha: desaparece al salir la app (Salir, cierre del proceso o caída) y vuelve al arrancar.
- **Ventanas pin siempre encima.** GNOME ignora `always_on_top` de las apps Wayland; la
  extensión pone `make_above()` a las ventanas cuyo título empieza por `knivchit-pin`.
- **Coloca la ventana principal** (título exacto `Knivchit` y proceso de la app: el título lo puede poner cualquier programa, así que se exige además que la ventana sea del PID dueño de `org.knivchit.App`) a la derecha del monitor primario,
  a 32 px del borde, centrada en vertical y recortada a lo que quepa. Una vez por ventana
  creada; si el cliente es X11 (el AppImage arranca con `GDK_BACKEND=x11`) vigila 1,5 s por si
  GTK la recoloca, y si el usuario la arrastra después, no se vuelve a tocar.
- **Sin animación para el overlay de captura** (título exacto `knivchit-capture-overlay`): el
  Shell lo animaría al abrirlo y cerrarlo, y delante de la foto congelada se vería como un
  efecto de movimiento.
- **Marca su presencia** tomando el nombre `org.knivchit.ClipboardService` mientras está
  activa, sin cola de espera: si otro proceso ya lo tiene, avisa y no sirve nada.

## Qué NO hace

- No accede al portapapeles ni lo escucha (el historial no va en la v0.1; el método
  `GetHistory` y la señal `HistoryChanged` son restos de ese diseño y no hacen nada).
- No usa la red, ni lanza procesos, ni guarda ni registra las teclas que pulsas.

## Contrato D-Bus (resumen)

Dos nombres en el bus de sesión: `org.knivchit.App` (lo expone la app) y
`org.knivchit.ClipboardService` (lo expone la extensión). Los nombres y las firmas solo
cambian a la vez en los dos lados.

| Interfaz | Método | Firma | Para qué |
|---|---|---|---|
| `org.knivchit.App` | `StartCapture` | `()` | Inicia una captura (la llama la extensión al pulsar el atajo). |
| `org.knivchit.App` | `ShowMain` | `()` | Muestra la ventana principal (la llama el icono de la barra). |
| `org.knivchit.ClipboardService` | `GetShortcuts` | `() → a{ss}` | Acción → acelerador GTK (`""` si no hay). Acciones: `capture` (disponible), `emoji` y `clipboard` (reservadas). |
| | `SetShortcut` | `(s accion, s accel) → (b ok, s error)` | Valida y guarda; `accel` vacío quita el atajo. Un error de validación es `(false, motivo)`, no un error D-Bus. Rechaza aceleradores sin modificador y los reservados (Ctrl+tecla, Alt+tecla de menú, Alt+F4, Alt+Tab, Super+L, Ctrl+Alt+Supr). |
| | `CheckConflicts` | `(s accel) → as` | Atajos del sistema que usan la misma combinación (solo informativo). |
| | `RecordShortcut` | `() → (s accel, s status)` | Graba UNA combinación (`ok`, `cancelled`, `timeout`, `invalid`, `busy`, `unavailable`); respuesta asíncrona de hasta 12 s; exige la ventana «Knivchit» enfocada y espera 750 ms entre grabaciones. |
| | `GetPanelIcon` | `() → b` | ¿Está activado el icono de la barra? |
| | `SetPanelIcon` | `(b) → (b ok, s error)` | Activa o desactiva el icono, en vivo y persistente. |

**Quién puede llamar.** Los métodos de la extensión solo los atiende la aplicación: el proceso
que posee `org.knivchit.App` (mismo usuario y mismo proceso, comprobado con
`GetNameOwner` + `GetConnectionCredentials`; la app llama desde otra conexión suya, por eso se
compara el proceso y no el nombre único). Cualquier otro proceso recibe
`org.freedesktop.DBus.Error.AccessDenied`, y también si la app no está en marcha.

## Privacidad: el grab del teclado

`RecordShortcut` captura teclado y ratón con un grab modal mientras dura la grabación (máx.
12 s). Solo se usa la combinación final, que se devuelve a quien la pidió; nada se guarda ni
se escribe en ningún registro. El grab se libera siempre: al terminar, con Esc, con un clic,
al vencer el tiempo, si la app que llamó desaparece del bus y al deshabilitar la extensión.

## Estructura

- `extension.js`: único archivo que importa `gi://Shell`, `gi://Meta`, `gi://St`,
  `gi://Clutter` y `Main`. Es solo pegamento; se verifica en una sesión GNOME (la anidada).
- `lib/`: lógica pura, sin Shell/Meta/Main ni Gtk, probada con `gjs` a secas.
- `icons/`: el icono simbólico del panel, cargado por ruta de la extensión.
- `schemas/`: GSettings (`org.gnome.shell.extensions.knivchit`): las claves de los atajos,
  vacías por defecto, y `show-panel-icon`.
- `tests/`: `dbus-run-session -- gjs -m extension/tests/<nombre>.test.js` (bus D-Bus privado;
  no usar el de la sesión real).

## Compatibilidad

Declarada y probada: **GNOME Shell 50**. Otras versiones no se han probado y por eso no se
declaran en `metadata.json`.

## Empaquetado e instalación

`./package.sh [salida]` genera `knivchit-extension-v<versión>.zip`; con `--ego`, el zip para
extensions.gnome.org (sin `schemas/gschemas.compiled`, que compila la plataforma).
`../install.sh` lo instala con `gnome-extensions install --force` y lo deja habilitado; hay
que cerrar sesión y volver a entrar (en Wayland no se puede recargar).

## Publicar en extensions.gnome.org

De momento la extensión se distribuye en el release de GitHub y la instala `install.sh`. Para
enviarla a extensions.gnome.org (la guía de revisión es la de gjs.guide) falta, por orden:

1. Un repositorio público al que apunte `url` en `metadata.json`.
2. Un `uuid` con un dominio que el autor controle (el actual es provisional).
3. Una licencia «or later» declarada (el `LICENSE` es la GPL-3.0) y cabeceras SPDX.
4. Poder explicar el código línea a línea (la guía rechaza código sobrante o generado sin
   revisar; el grab modal es lo que más mirará un revisor) y quitar el historial sin uso
   (`GetHistory`, `HistoryChanged`).
5. Que la plataforma acepte una extensión que depende de una app externa, y una descripción
   en inglés.
6. Probar en otras versiones del Shell antes de ampliar `shell-version`.

Ya cumple: nada se crea antes de `enable()`, `disable()` lo destruye todo, sin red, sin
subprocesos, sin código ofuscado, sin telemetría, esquema con el prefijo exigido y **sin
atajos por defecto** (la guía los prohíbe sobre el portapapeles).

## Licencia

GPL-3.0 (ver `LICENSE`).
