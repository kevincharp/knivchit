// Atajos de teclado de Knivchit: validación de aceleradores, detección de
// conflictos y la lógica que expone D-Bus (GetShortcuts/SetShortcut/
// CheckConflicts). Pura: sin gi://Shell, gi://Meta ni Main, y tampoco Gtk
// (extensions.gnome.org prohíbe importarlo en el proceso del Shell). Lo que
// depende del Shell se inyecta: si una tecla existe (Clutter.keyval_from_name),
// de dónde salen los atajos del sistema (GSettings) y el aviso de cambio.
//
// Knivchit NO fija ningún atajo por defecto: el usuario elige los suyos.

// Acción (nombre que ve la app por D-Bus) -> clave del GSettings de la
// extensión. `available: false` son acciones previstas que aún no hacen nada:
// sus claves existen (vacías) pero no se ligan ni se pueden asignar todavía.
export const ACTIONS = {
  capture: { key: "knivchit-start-capture", available: true },
  emoji: { key: "knivchit-open-emoji", available: false },
  clipboard: { key: "knivchit-open-clipboard", available: false },
};

// Nombres de modificador (sin distinguir mayúsculas) -> nombre canónico. Es el
// conjunto que acepta GTK4; el modo `lenient` (atajos que ya existen en el
// sistema) admite además los alias antiguos de X11.
const MODIFIERS = {
  shift: "Shift",
  control: "Control",
  ctrl: "Control",
  ctl: "Control",
  primary: "Control",
  alt: "Alt",
  super: "Super",
  hyper: "Hyper",
  meta: "Meta",
};
const LENIENT_MODIFIERS = { ...MODIFIERS, mod1: "Alt", mod4: "Super" };
const IGNORED_MODIFIERS = new Set(["mod2", "mod3", "mod5", "release"]); // BloqNum, etc.: no cuentan al comparar

const MODIFIER_KEYSYM =
  /^(Shift|Control|Alt|Super|Meta|Hyper)_[LR]$|^(Caps|Shift|Num)_Lock$|^ISO_Level[35]_(Shift|Latch|Lock)$|^Mode_switch$/;
/** ¿Es el nombre de una tecla modificadora (Shift_L, Super_R, Caps_Lock…)? No sirve como «la tecla» de un atajo. */
export const isModifierKeysym = (name) => MODIFIER_KEYSYM.test(name);
const FUNCTION_KEY = /^F([1-9]|[12][0-9]|3[0-5])$/;

// Combinaciones que un atajo global NO puede ocupar: romperían la edición o el
// escritorio en todas las aplicaciones (EXT-02). Devuelve el motivo o null.
const ALT_MNEMONIC_KEY = /^[a-zA-Z0-9]$|^(space|Return|BackSpace|Delete|Insert|Home|End|Left|Right|Up|Down)$/;
const has = (mods, ...wanted) => wanted.every((m) => mods.includes(m));
const only = (mods, ...allowed) => mods.every((m) => allowed.includes(m));
const ESSENTIAL = [
  [(m, k) => has(m, "Alt") && k === "f4", "Alt+F4 cierra ventanas"],
  [(m, k) => has(m, "Alt") && (k === "tab" || k === "iso_left_tab"), "Alt+Tab cambia de ventana"],
  [(m, k) => has(m, "Super") && k === "l", "Super+L bloquea la pantalla"],
  [(m, k) => has(m, "Control", "Alt") && (k === "delete" || k === "backspace"), "Ctrl+Alt+Supr/Retroceso son de sistema"],
];
export function reservedReason(mods, key) {
  const k = key.toLowerCase();
  for (const [test, why] of ESSENTIAL) if (test(mods, k)) return `${why}: elige otra combinación.`;
  if (FUNCTION_KEY.test(key)) return null;
  if (has(mods, "Control") && only(mods, "Control", "Shift"))
    return "Ctrl+tecla (con o sin Mayús) es la edición de todas las aplicaciones (copiar, pegar…): añade Super o Alt.";
  if (has(mods, "Alt") && only(mods, "Alt", "Shift") && ALT_MNEMONIC_KEY.test(key))
    return "Alt+tecla abre los menús de las aplicaciones: añade Super o Ctrl.";
  return null;
}

/**
 * Valida y normaliza un acelerador con formato GTK (`<Super><Shift>c`).
 * Reglas: texto no vacío; modificadores entre `<>` seguidos de UNA tecla que exista; la tecla no
 * puede ser modificadora; hace falta al menos un modificador distinto de Shift salvo en las teclas
 * F (Shift+letra solo teclearía mayúsculas: secuestraría la escritura).
 *
 * `isKnownKey(nombre)` decide si una tecla existe. Con `lenient` (para leer atajos del sistema) se
 * omiten las reglas de uso y la comprobación de tecla.
 *
 * Devuelve { ok: true, accel, mods, key } con `accel` normalizado (modificadores canónicos en el
 * orden escrito, sin repetir; letra en minúscula) o { ok: false, error } con el motivo legible.
 */
export function parseAccelerator(input, isKnownKey, { lenient = false, allowReserved = false } = {}) {
  if (typeof input !== "string") return { ok: false, error: "El acelerador debe ser un texto." };
  const text = input.trim();
  if (text === "") return { ok: false, error: "El acelerador está vacío." };

  const match = /^((?:<[^<>\s]+>)*)([^<>\s]*)$/.exec(text);
  if (!match) return { ok: false, error: `Formato inválido: «${text}». Usa, por ejemplo, <Super><Shift>c.` };

  const names = lenient ? LENIENT_MODIFIERS : MODIFIERS;
  const mods = [];
  for (const token of match[1].match(/<[^<>]+>/g) ?? []) {
    const raw = token.slice(1, -1).toLowerCase();
    if (lenient && IGNORED_MODIFIERS.has(raw)) continue;
    const canonical = names[raw];
    if (!canonical) return { ok: false, error: `Modificador desconocido «${token}».` };
    if (!mods.includes(canonical)) mods.push(canonical);
  }

  let key = match[2];
  if (key === "") return { ok: false, error: "Falta la tecla: un acelerador no puede ser solo modificadores." };
  if (/^[A-Z]$/.test(key)) key = key.toLowerCase();

  if (!lenient) {
    if (!isKnownKey(key)) return { ok: false, error: `Tecla desconocida «${key}».` };
    if (MODIFIER_KEYSYM.test(key)) return { ok: false, error: `«${key}» es una tecla modificadora; no vale como tecla del atajo.` };
    if (!mods.some((m) => m !== "Shift") && !FUNCTION_KEY.test(key))
      return { ok: false, error: "Hace falta al menos un modificador (Ctrl, Alt o Super) salvo en las teclas F." };
  }

  if (!lenient && !allowReserved) {
    const reserved = reservedReason(mods, key);
    if (reserved) return { ok: false, error: reserved };
  }

  return { ok: true, accel: mods.map((m) => `<${m}>`).join("") + key, mods, key };
}

// Identidad de una combinación: mismos modificadores (sin importar el orden) y
// misma tecla (sin importar mayúsculas).
const combinationId = (parsed) => `${[...parsed.mods].sort().join("")}|${parsed.key.toLowerCase()}`;

/**
 * Descripciones legibles de los atajos de `bindings` ({ accel, description })
 * que coinciden con el acelerador ya validado `parsed`, sin repetir.
 */
export function findConflicts(parsed, bindings) {
  if (!parsed?.ok) return [];
  const wanted = combinationId(parsed);
  const found = [];
  for (const { accel, description } of bindings) {
    if (!accel || accel === "disabled") continue;
    const other = parseAccelerator(accel, null, { lenient: true });
    if (other.ok && combinationId(other) === wanted && !found.includes(description)) found.push(description);
  }
  return found;
}

/**
 * Lo que expone `org.knivchit.ClipboardService` sobre atajos. `settings` es
 * el Gio.Settings de la extensión (get_strv/set_strv); `systemBindings()`
 * devuelve los atajos ya existentes en el sistema; `onChanged(action, accel)`
 * avisa tras un cambio (accel vacío = quitado).
 */
export class ShortcutManager {
  constructor({ settings, isKnownKey, systemBindings, onChanged = () => {} }) {
    this._settings = settings;
    this._isKnownKey = isKnownKey;
    this._systemBindings = systemBindings;
    this._onChanged = onChanged;
  }

  // acción -> acelerador; cadena vacía si no hay ninguno asignado.
  getShortcuts() {
    const result = {};
    for (const [name, { key }] of Object.entries(ACTIONS)) result[name] = this._settings.get_strv(key)[0] ?? "";
    return result;
  }

  // -> [ok, error]. Un acelerador vacío quita el atajo. No mira conflictos:
  // eso es CheckConflicts, y la app decide si avisa antes de aceptar.
  setShortcut(action, accel) {
    const entry = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!entry) return [false, `Acción desconocida «${action}».`];
    if (!entry.available) return [false, `La acción «${action}» todavía no está disponible.`];

    if (typeof accel === "string" && accel.trim() === "") {
      this._settings.set_strv(entry.key, []);
      this._onChanged(action, "");
      return [true, ""];
    }
    const parsed = parseAccelerator(accel, this._isKnownKey);
    if (!parsed.ok) return [false, parsed.error];
    this._settings.set_strv(entry.key, [parsed.accel]);
    this._onChanged(action, parsed.accel);
    return [true, ""];
  }

  // Vacía las claves de GSettings cuyo valor no pasa las reglas de uso (p. ej. uno
  // heredado de la extensión anterior, o escrito en dconf por otro proceso sin pasar
  // por D-Bus). Devuelve las acciones que se vaciaron.
  sanitize() {
    const cleared = [];
    for (const [action, { key }] of Object.entries(ACTIONS)) {
      const values = this._settings.get_strv(key);
      if (values.length === 0) continue;
      const parsed = parseAccelerator(values[0], this._isKnownKey);
      if (values.length === 1 && parsed.ok) continue;
      this._settings.set_strv(key, []);
      this._onChanged(action, "");
      cleared.push(action);
    }
    return cleared;
  }

  // Atajos del sistema que chocan con `accel`. Con un acelerador inválido, [].
  checkConflicts(accel) {
    return findConflicts(parseAccelerator(accel, this._isKnownKey, { allowReserved: true }), this._systemBindings());
  }
}
