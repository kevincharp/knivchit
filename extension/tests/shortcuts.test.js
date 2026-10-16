import {
  ACTIONS,
  findConflicts,
  isModifierKeysym,
  parseAccelerator,
  ShortcutManager,
} from "../lib/shortcuts.js";

// Corre con `gjs -m extension/tests/shortcuts.test.js` (no necesita bus).
// La lógica de atajos es pura: el Shell le inyecta cómo saber si una tecla
// existe (Clutter) y de dónde salen los atajos del sistema (GSettings).

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};

// Teclas «conocidas» para las pruebas (en el Shell real es Clutter.keyval_from_name).
const KNOWN = new Set([
  "a", "c", "l", "v", "x", "1", "space", "period", "comma", "Tab", "Escape", "Print", "Delete", "Page_Up", "Left",
  "Shift_L", "Control_R", "Super_L", "Caps_Lock", "ISO_Level3_Shift",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
]);
const isKnownKey = (name) => KNOWN.has(name);

// --- parseAccelerator: aceptados y su forma normalizada -----------------------
const good = [
  ["<Super><Shift>c", "<Super><Shift>c"],
  ["<Super><Shift>C", "<Super><Shift>c"], // la letra va en minúscula
  ["<super><shift>c", "<Super><Shift>c"], // los modificadores no distinguen mayúsculas
  ["<Control><Alt>c", "<Control><Alt>c"],
  ["<Ctrl><Alt>c", "<Control><Alt>c"], // alias
  ["<Primary><Alt>c", "<Control><Alt>c"],
  ["<Super>space", "<Super>space"],
  ["<Super>period", "<Super>period"],
  ["<Super>Tab", "<Super>Tab"],
  ["<Super><Super>c", "<Super>c"], // repetido: se deduplica
  ["F9", "F9"], // las teclas F valen sin modificador
  ["<Shift>F9", "<Shift>F9"],
  ["<Super>F12", "<Super>F12"],
  ["  <Super>c  ", "<Super>c"], // espacios alrededor
  ["<Alt>Print", "<Alt>Print"],
];
for (const [input, want] of good) {
  const r = parseAccelerator(input, isKnownKey);
  if (!r.ok) fail(`«${input}» debería ser válido y dio error: ${r.error}`);
  eq(r.accel, want, `normalización de «${input}»`);
}

// --- parseAccelerator: rechazados, cada uno por su motivo ------------------------
const bad = [
  ["", "vacío"],
  ["   ", "vacío"],
  ["c", "modificador"], // tecla suelta
  ["Tab", "modificador"],
  ["<Shift>c", "modificador"], // Shift solo teclearía mayúsculas: secuestraría la escritura
  ["<Shift>space", "modificador"],
  ["<Super>", "tecla"], // solo modificadores
  ["<Super><Shift>", "tecla"],
  ["<Super>xx", "desconocida"], // tecla que no existe
  ["<Super>Shift_L", "modificadora"], // una tecla modificadora no es una tecla
  ["Caps_Lock", "modificadora"],
  ["<Hola>c", "Modificador"], // modificador inventado
  ["<Mod4>c", "Modificador"], // GTK4 tampoco lo acepta
  ["<Super>c<Shift>", "formato"], // modificador detrás de la tecla
  ["<Super>c d", "formato"], // espacios dentro
  ["<Super>>c", "formato"],
  // reservados: romperían la edición o el escritorio en todas las aplicaciones
  ["<Control>c", "edición"],
  ["<Primary>v", "edición"],
  ["<Control><Shift>v", "edición"],
  ["<Control>space", "edición"],
  ["<Alt>a", "menús"],
  ["<Alt><Shift>1", "menús"],
  ["<Alt>F4", "cierra"],
  ["<Alt>Tab", "cambia"],
  ["<Super>l", "bloquea"],
  ["<Control><Alt>Delete", "sistema"],
  [null, "texto"],
  [undefined, "texto"],
  [42, "texto"],
];
for (const [input, fragment] of bad) {
  const r = parseAccelerator(input, isKnownKey);
  if (r.ok) fail(`«${input}» debería rechazarse y se aceptó como ${r.accel}`);
  if (!r.error.toLowerCase().includes(fragment.toLowerCase()))
    fail(`«${input}»: el error «${r.error}» debería mencionar «${fragment}»`);
}

// --- findConflicts: misma combinación aunque se escriba distinto -----------------------
const sys = [
  { accel: "<Super>l", description: "Bloquear pantalla [Sistema]" },
  { accel: "<Super>v", description: "Mostrar la lista de notificaciones [Shell]" },
  { accel: "<Primary><Alt>Delete", description: "Cerrar sesión [Sistema]" },
  { accel: "<Control><Super>Left", description: "Mover a la izquierda [Sistema]" },
  { accel: "<Mod4>x", description: "Atajo con alias antiguo [Personalizado]" },
  { accel: "<Super>page_up", description: "Espacio de trabajo anterior [Sistema]" },
  { accel: "", description: "sin atajo" },
  { accel: "disabled", description: "deshabilitado" },
];
const conflicts = (accel) => findConflicts(parseAccelerator(accel, isKnownKey, { allowReserved: true }), sys);
eq(conflicts("<Super>l"), ["Bloquear pantalla [Sistema]"], "<Super>l");
eq(conflicts("<super>L"), ["Bloquear pantalla [Sistema]"], "<super>L (mayúsculas)");
eq(conflicts("<Super>v"), ["Mostrar la lista de notificaciones [Shell]"], "<Super>v");
eq(conflicts("<Control><Alt>Delete"), ["Cerrar sesión [Sistema]"], "Primary = Control, orden distinto");
eq(conflicts("<Alt><Ctrl>Delete"), ["Cerrar sesión [Sistema]"], "orden de modificadores");
eq(conflicts("<Super><Control>Left"), ["Mover a la izquierda [Sistema]"], "Super+Control+Left");
eq(conflicts("<Super>x"), ["Atajo con alias antiguo [Personalizado]"], "alias <Mod4> del sistema");
eq(conflicts("<Super>Page_Up"), ["Espacio de trabajo anterior [Sistema]"], "teclas con nombre sin distinguir mayúsculas");
eq(conflicts("<Super><Shift>c"), [], "libre");
eq(conflicts("<Super><Shift>l"), [], "más modificadores = otra combinación");
eq(findConflicts({ ok: false, error: "x" }, sys), [], "acelerador inválido => sin conflictos");
eq(
  findConflicts(parseAccelerator("<Super>l", isKnownKey, { allowReserved: true }), [
    { accel: "<Super>l", description: "A" },
    { accel: "<Super>L", description: "A" },
    { accel: "<Super>l", description: "B" },
  ]),
  ["A", "B"],
  "descripciones repetidas se deduplican",
);

// --- isModifierKeysym: qué teclas no cuentan como «la tecla» del atajo ----------------------------
for (const n of ["Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R", "Super_L", "Super_R", "Meta_L", "Hyper_R", "Caps_Lock", "Num_Lock", "Shift_Lock", "ISO_Level3_Shift", "Mode_switch"])
  if (!isModifierKeysym(n)) fail(`${n} debería ser una tecla modificadora`);
for (const n of ["c", "Tab", "F9", "Escape", "space", "exclam", "Print", "Super", "Shift"])
  if (isModifierKeysym(n)) fail(`${n} no debería ser una tecla modificadora`);

// --- ShortcutManager: lo que expone D-Bus ------------------------------------------------
const makeManager = () => {
  const store = new Map(Object.values(ACTIONS).map((a) => [a.key, []]));
  const settings = {
    get_strv: (key) => [...store.get(key)],
    set_strv: (key, value) => {
      if (!store.has(key)) throw new Error(`clave desconocida ${key}`);
      store.set(key, [...value]);
      return true;
    },
  };
  const changes = [];
  const manager = new ShortcutManager({
    settings,
    isKnownKey,
    systemBindings: () => sys,
    onChanged: (action, accel) => changes.push([action, accel]),
  });
  return { manager, store, changes };
};

{
  const { manager, store, changes } = makeManager();
  // las tres acciones siempre presentes y vacías de entrada: nada asignado por defecto
  eq(manager.getShortcuts(), { capture: "", emoji: "", clipboard: "" }, "GetShortcuts inicial");

  eq(manager.setShortcut("capture", "<Super><Shift>C"), [true, ""], "asignar capturar");
  eq(store.get("knivchit-start-capture"), ["<Super><Shift>c"], "se guardó normalizado");
  eq(manager.getShortcuts().capture, "<Super><Shift>c", "GetShortcuts tras asignar");
  eq(changes, [["capture", "<Super><Shift>c"]], "aviso de cambio");

  eq(manager.setShortcut("capture", "<Control><Alt>c"), [true, ""], "reasignar");
  eq(store.get("knivchit-start-capture"), ["<Control><Alt>c"], "reasignar sustituye, no añade");

  // errores: devuelven [false, motivo] y NO tocan lo guardado
  for (const [action, accel, fragment] of [
    ["capture", "c", "modificador"],
    ["capture", "<Super>xx", "desconocida"],
    ["capture", "<Super>", "tecla"],
    ["nueva", "<Super>c", "desconocida"],
    ["emoji", "<Super>period", "disponible"], // reservada, aún sin función
    ["clipboard", "<Super>x", "disponible"],
  ]) {
    const [ok, error] = manager.setShortcut(action, accel);
    if (ok) fail(`SetShortcut(${action}, ${accel}) debería fallar`);
    if (!error.toLowerCase().includes(fragment)) fail(`SetShortcut(${action}, ${accel}): «${error}» debería mencionar «${fragment}»`);
  }
  eq(store.get("knivchit-start-capture"), ["<Control><Alt>c"], "los errores no modifican lo guardado");
  eq(store.get("knivchit-open-emoji"), [], "las acciones reservadas siguen vacías");
  eq(changes.length, 2, "los errores no avisan de cambios");

  // vacío = quitar el atajo
  eq(manager.setShortcut("capture", ""), [true, ""], "quitar");
  eq(store.get("knivchit-start-capture"), [], "quitar deja la clave vacía");
  eq(manager.getShortcuts().capture, "", "GetShortcuts tras quitar");
  eq(changes[changes.length - 1], ["capture", ""], "aviso de quitar");
  eq(manager.setShortcut("capture", "  "), [true, ""], "solo espacios también quita");

  eq(manager.checkConflicts("<Super>l"), ["Bloquear pantalla [Sistema]"], "CheckConflicts delega");
  eq(manager.checkConflicts("basura<<"), [], "CheckConflicts con acelerador inválido => []");
}

// --- el esquema de la extensión: Knivchit no fija ningún atajo --------------------------------
for (const [name, action] of Object.entries(ACTIONS))
  if (typeof action.key !== "string" || !action.key.startsWith("knivchit-"))
    fail(`la acción ${name} no tiene una clave knivchit-*`);
eq(Object.keys(ACTIONS), ["capture", "emoji", "clipboard"], "acciones conocidas");
eq(Object.values(ACTIONS).map((a) => a.available), [true, false, false], "solo capturar tiene función hoy");

// sanitize(): lo que ya hay en GSettings se somete a las reglas de SetShortcut
{
  const { manager, store, changes } = makeManager();
  store.set("knivchit-start-capture", ["<Control>c"]); // heredado de la extensión anterior
  store.set("knivchit-open-emoji", ["<Super>space"]); // válido: se conserva
  store.set("knivchit-open-clipboard", ["c", "<Super>v"]); // varios valores o inválido: se vacía
  eq(manager.sanitize(), ["capture", "clipboard"], "sanitize devuelve lo vaciado");
  eq(store.get("knivchit-start-capture"), [], "<Control>c heredado se vacía");
  eq(store.get("knivchit-open-emoji"), ["<Super>space"], "un atajo válido no se toca");
  eq(store.get("knivchit-open-clipboard"), [], "un valor inválido se vacía");
  eq(changes, [["capture", ""], ["clipboard", ""]], "avisa de lo vaciado");
  eq(manager.sanitize(), [], "es idempotente");
}

print("PASS: shortcuts valida aceleradores, detecta conflictos y gestiona GetShortcuts/SetShortcut/CheckConflicts");
