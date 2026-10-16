# Arquitectura

[English](architecture.md) | **Español**

La app es **local**: sin servidor, sin cuentas, sin telemetría. Dos piezas con stacks distintos, y es intencional.

```
 atajo global ──► extension/ (GJS, dentro de GNOME Shell)
                    │  D-Bus de sesión
                    ▼
                  app/ (Tauri v2: Rust + React)
                    ├─ backend Rust: valida, guarda, copia, fija
                    └─ frontend web: overlay, anotador, ventana principal
```

## Por qué dos partes

En GNOME sobre Wayland una aplicación no puede registrar atajos globales, colocar su propia ventana ni mantener otra encima. Solo el compositor puede, y la única vía legítima es una **extensión de GNOME Shell**, que corre en su proceso y debe ser GJS. Todo lo demás vive en `app/`, que no tiene esa restricción.

## `app/` — el producto

- **Backend (`app/src-tauri/`)**, Rust: comandos de Tauri, captura por el portal de XDG, guardado, copia al portapapeles, ventanas fijadas, ajustes y la base SQLite. Cada comando valida sus argumentos antes de tocar datos.
- **Frontend (`app/src/`)**, React 19 + TypeScript + Tailwind v4: el overlay de captura, el anotador, la ventana principal y los ajustes. **Compone la imagen final** (recorte a resolución nativa más las anotaciones) y la envía al backend. La UI habla con Rust solo a través de `app/src/lib/tauri.ts`.
- **Base de datos:** SQLite embebida. El esquema vive solo en `app/src-tauri/src/db/migrations.rs`; una migración aplicada no se edita, se añade otra.
- **Diseño:** los tokens (colores, radios, tipografía) están en `app/src/styles/theme.css`, con tema oscuro y claro.

### Base de datos (SQLite)

- SQLite embebida con `tauri-plugin-sql`. Solo `app/src-tauri/src/db/mod.rs` abre la conexión; ningún comando ni test abre una propia contra el archivo real.
- El esquema vive solo en `app/src-tauri/src/db/migrations.rs`. Una migración nueva lleva el número de versión siguiente; **una migración aplicada no se edita**, se corrige hacia adelante con otra. El SQL va siempre parametrizado.
- `settings` es una fila única (`id = 1`, forzado por un `CHECK`): toda escritura es un `UPDATE`. Las tablas de historial y capturas usan borrado real.
- Los tests corren contra `:memory:`, nunca contra un archivo compartido entre tests.

## `extension/`: el puente con el Shell

Extensión de GNOME Shell en GJS puro. Hace solo lo que exige el compositor: registrar el atajo global, grabar combinaciones de teclas, colocar la ventana principal a la derecha de la pantalla y mantener encima las capturas fijadas. Sin interfaz ni lógica de negocio. Su lógica pura está en `extension/lib/` (sin `Shell`, `Meta` ni `Main`) para poder probarse con `gjs` a secas.

## Cómo se hablan: D-Bus

Dos nombres en el bus de sesión; solo cambian a la vez en los dos lados:

- `org.knivchit.App`, expuesto por la **app** (vía `zbus`): `StartCapture` y `ShowMain` no toman argumentos ni devuelven datos. `TogglePopup` está reservado para una función futura. La app comprueba quién llama: `ShowMain` y `StartCapture` solo atienden a procesos del mismo usuario cuyo ejecutable sea `gnome-shell` (que debe ser de root y no escribible por nadie más) o, solo para `ShowMain`, otro proceso de Knivchit; el resto de procesos de la sesión se rechaza con `org.freedesktop.DBus.Error.AccessDenied`, igual que cualquier llamante que no se pueda verificar. El ejecutable se identifica por su nombre, así que cualquier proceso del mismo usuario que se llame `knivchit` aún puede pedir a la app que muestre su ventana; no puede iniciar una captura.
- `org.knivchit.ClipboardService`, expuesto por la **extensión**: gestión de atajos (`GetShortcuts`, `SetShortcut`, `CheckConflicts`, `RecordShortcut`). Solo atiende a la app (mismo UID y PID que el dueño de `org.knivchit.App`); cualquier otro recibe `AccessDenied`. Se rechazan aceleradores reservados o inválidos (como `Alt+F4` o `Super+L`). `RecordShortcut` captura el teclado solo durante la grabación, siempre lo libera y se niega a actuar con la sesión bloqueada.

El bus de sesión **no es confidencial** frente a otros procesos del mismo usuario, así que nada sensible (contenido del portapapeles, texto a insertar) viaja por él: usa un `socketpair` privado cuyo descriptor se pasa por D-Bus. Los tests de este contrato corren en un bus **privado** (`dbus-run-session`), nunca en el de sesión real. Cambiar una firma exige tocar los dos lados en el mismo commit.

## Camino de una captura

1. El usuario pulsa su atajo → la extensión llama a `StartCapture` en la app (o pulsa el botón de la ventana principal).
2. La app oculta su ventana y pide la pantalla completa al portal de XDG (sin selector nativo).
3. Abre el overlay a pantalla completa sobre esa foto congelada.
4. El usuario dibuja la selección, la mueve o redimensiona y anota con la barra de herramientas.
5. El frontend compone el PNG final y lo envía a Rust, que lo **guarda**, lo **copia** o lo **fija** en una ventana flotante.

## Límites de módulos

| Capa | Puede importar de | Nunca |
|---|---|---|
| `app/src/components/**` | `app/src/lib/tauri.ts` | llamar a `invoke()` directamente |
| `app/src-tauri/src/dbus/**` | `app/src-tauri/src/db/` | nada del frontend |
| `app/src-tauri/src/db/**` | nada interno | abrirse desde fuera de `db/` |
| `extension/extension.js` | `extension/lib/` | ser importado por `extension/lib/` |
| `extension/lib/**` | GJS estándar, `gi://Gio` | `gi://Shell`, `gi://Meta`, `Main` |

## Fuera de la app

- **`landing/`**: sitio estático de promoción (`landing/site/` es lo que se despliega). No forma parte del build de la app. Ver [`landing/README.md`](../landing/README.md).
- **`install.sh`**: instalador del release (verifica `SHA256SUMS`).
- **`.github/workflows/`**: CI (el gate) y publicación de releases por etiqueta. Ver [`branches.es.md`](branches.es.md).

## Más detalle

[`extension/README.md`](../extension/README.md), [`app/README.md`](../app/README.md) y [`CONTRIBUTING.es.md`](../CONTRIBUTING.es.md) (comandos y reglas).
