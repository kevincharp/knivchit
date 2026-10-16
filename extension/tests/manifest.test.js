import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ACTIONS } from "../lib/shortcuts.js";

// Comprueba que la extensión puede llamar a getSettings(): metadata.json
// declara "settings-schema", ese id existe en el XML, el esquema compila y
// cada atajo que extension.js registra es una clave del esquema. Sin
// "settings-schema" el Shell deja la extensión en ERROR al hacer enable().
// Corre con `gjs -m extension/tests/manifest.test.js` (no necesita bus).

const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
const root = GLib.path_get_dirname(here);

const read = (path) => new TextDecoder().decode(GLib.file_get_contents(path)[1]);
const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};

const metadata = JSON.parse(read(`${root}/metadata.json`));
if (!metadata["settings-schema"]) fail('metadata.json no declara "settings-schema"');

const schemaDir = `${root}/schemas`;
const xmlName = "org.gnome.shell.extensions.knivchit.gschema.xml";
const xml = read(`${schemaDir}/${xmlName}`);
const idMatch = xml.match(/<schema id="([^"]+)"/);
if (!idMatch || idMatch[1] !== metadata["settings-schema"])
  fail(`settings-schema (${metadata["settings-schema"]}) no coincide con el id del XML (${idMatch?.[1]})`);

const tmp = GLib.dir_make_tmp("knivchit-schemas-XXXXXX");
try {
  GLib.file_set_contents(`${tmp}/${xmlName}`, xml);
  const proc = Gio.Subprocess.new(
    ["glib-compile-schemas", "--strict", tmp],
    Gio.SubprocessFlags.STDERR_PIPE,
  );
  const [, , stderr] = proc.communicate_utf8(null, null);
  if (!proc.get_successful()) fail(`glib-compile-schemas falló: ${stderr}`);

  const source = Gio.SettingsSchemaSource.new_from_directory(
    tmp,
    Gio.SettingsSchemaSource.get_default(),
    false,
  );
  const schema = source.lookup(metadata["settings-schema"], false);
  if (!schema) fail("el esquema compilado no se puede cargar");

  const extensionJs = read(`${root}/extension.js`);
  const names = [...extensionJs.matchAll(/_NAME = "([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) fail("extension.js no registra ningún atajo");
  for (const name of names)
    if (!schema.has_key(name)) fail(`extension.js usa el atajo "${name}", que no está en el esquema`);

  // Knivchit no fija ningún atajo por defecto: los elige el usuario en
  // Configuración. Es además regla de extensions.gnome.org («An extension MUST
  // NOT ship with default keyboard shortcuts for interacting with clipboard
  // data»). Las claves de acciones futuras (emoji, portapapeles) pueden
  // existir, pero vacías y SIN ligar a nada en extension.js todavía.
  // Único ajuste que no es un atajo: el icono de la barra superior (booleano, activado por defecto).
  const NON_SHORTCUT_KEYS = { "show-panel-icon": { type: "b", defaultValue: true } };
  for (const [key, { type, defaultValue }] of Object.entries(NON_SHORTCUT_KEYS)) {
    if (!schema.has_key(key)) fail(`falta la clave "${key}" en el esquema`);
    const value = schema.get_key(key).get_default_value();
    if (value.get_type_string() !== type || value.get_boolean() !== defaultValue)
      fail(`la clave "${key}" debe ser de tipo ${type} y valer ${defaultValue} por defecto`);
  }
  for (const key of schema.list_keys()) {
    if (key in NON_SHORTCUT_KEYS) continue;
    const value = schema.get_key(key).get_default_value();
    if (value.get_type_string() !== "as") fail(`la clave "${key}" no es una lista de aceleradores (as)`);
    if (value.get_strv().length > 0)
      fail(`la clave "${key}" tiene un atajo por defecto (${value.get_strv()}); debe venir vacía`);
  }
  // El pegamento del Shell no se puede ejecutar fuera de GNOME, pero sí vigilar que no pierda las
  // piezas de las que depende la app: exportar el servicio D-Bus, tomar y soltar su nombre, y
  // liberar el grab modal de la grabación al deshabilitar.
  const enableBody = extensionJs.slice(extensionJs.indexOf("  enable() {"), extensionJs.indexOf("  disable() {"));
  const disableBody = extensionJs.slice(extensionJs.indexOf("  disable() {"));
  for (const [what, source, pattern] of [
    ["exportar el objeto D-Bus", enableBody, /this\._service\.export\(Gio\.DBus\.session, "\/org\/knivchit\/ClipboardService"\)/],
    ["tomar el nombre org.knivchit.ClipboardService sin cola", enableBody, /requestServiceName\(Gio\.DBus\.session/],
    ["soltar el nombre org.knivchit.ClipboardService", disableBody, /"ReleaseName"[\s\S]*"org\.knivchit\.ClipboardService"/],
    ["abortar la grabación en disable()", disableBody, /this\._recorder\?\.dispose\(\)/],
    ["quitar el icono de la barra en disable()", disableBody, /this\._panelIcon\?\.stop\(\)/],
    ["retirar el atajo en disable()", disableBody, /Main\.wm\.removeKeybinding\(CAPTURE_KEYBINDING_NAME\)/],
  ])
    if (!pattern.test(source)) fail(`extension.js debe ${what}`);

  for (const [action, { key }] of Object.entries(ACTIONS))
    if (!schema.has_key(key)) fail(`la acción "${action}" usa la clave "${key}", que no está en el esquema`);
  for (const name of names)
    if (/clipboard|portapapeles|emoji/i.test(name))
      fail(`extension.js liga "${name}", una acción que aún no existe`);
} finally {
  GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
}

print("PASS: metadata.json declara el esquema, compila y cubre los atajos");
