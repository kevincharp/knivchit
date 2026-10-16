import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { findConflicts, parseAccelerator } from "../lib/shortcuts.js";
import { readSystemBindings } from "../lib/systemBindings.js";

// Corre con `gjs -m extension/tests/systemBindings.test.js` (no necesita bus).
// Usa esquemas de prueba con los MISMOS ids que los de GNOME y un backend de
// GSettings aislado (un keyfile temporal): no lee ni escribe la configuración
// real. Al final, una prueba de humo contra los esquemas reales si existen.

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};

const tmp = GLib.dir_make_tmp("knivchit-sysbind-XXXXXX");
const schemaXml = (id, keys, path) => `<schema id="${id}"${path ? ` path="${path}"` : ""} gettext-domain="test">${keys}</schema>`;
const asKey = (name, def, summary) =>
  `<key name="${name}" type="as"><default>${def}</default><summary>${summary}</summary><description>.</description></key>`;
const xml = `<?xml version="1.0" encoding="UTF-8"?><schemalist>
${schemaXml("org.gnome.desktop.wm.keybindings", asKey("switch-applications", "['&lt;Super&gt;Tab', '&lt;Alt&gt;Tab']", "Cambiar de aplicación") + asKey("close", "['&lt;Alt&gt;F4']", "Cerrar ventana") + asKey("sin-atajo", "[]", "Sin atajo"), "/org/gnome/desktop/wm/keybindings/")}
${schemaXml("org.gnome.shell.keybindings", asKey("toggle-message-tray", "['&lt;Super&gt;v', '&lt;Super&gt;m']", "Mostrar la lista de notificaciones"), "/org/gnome/shell/keybindings/")}
${schemaXml("org.gnome.mutter.keybindings", asKey("toggle-tiled-left", "['&lt;Super&gt;Left']", "Teselar a la izquierda"), "/org/gnome/mutter/keybindings/")}
${schemaXml("org.gnome.mutter.wayland.keybindings", asKey("restore-shortcuts", "['&lt;Super&gt;Escape']", "Restaurar atajos"), "/org/gnome/mutter/wayland/keybindings/")}
${schemaXml(
  "org.gnome.settings-daemon.plugins.media-keys",
  asKey("screensaver", "['&lt;Super&gt;l']", "Bloquear pantalla") +
    asKey("play", "['XF86AudioPlay']", "Reproducir") +
    `<key name="custom-keybindings" type="as"><default>[]</default></key>
     <key name="volume-step" type="i"><default>6</default></key>`,
  "/org/gnome/settings-daemon/plugins/media-keys/",
)}
${schemaXml(
  "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
  `<key name="name" type="s"><default>''</default></key><key name="command" type="s"><default>''</default></key><key name="binding" type="s"><default>''</default></key>`,
)}
</schemalist>`;
GLib.file_set_contents(`${tmp}/test.gschema.xml`, xml);
const compile = Gio.Subprocess.new(["glib-compile-schemas", "--strict", tmp], Gio.SubprocessFlags.STDERR_PIPE);
const [, , stderr] = compile.communicate_utf8(null, null);
if (!compile.get_successful()) fail(`glib-compile-schemas falló: ${stderr}`);

const source = Gio.SettingsSchemaSource.new_from_directory(tmp, null, false);
const backend = Gio.keyfile_settings_backend_new(`${tmp}/settings.ini`, "/", "root");

// Dos atajos personalizados del usuario, tal como los guarda gnome-control-center
const customPaths = [
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/",
  "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom1/",
];
const mediaKeys = Gio.Settings.new_full(source.lookup("org.gnome.settings-daemon.plugins.media-keys", true), backend, null);
mediaKeys.set_strv("custom-keybindings", customPaths);
const custom = (path, name, binding) => {
  const s = Gio.Settings.new_full(source.lookup("org.gnome.settings-daemon.plugins.media-keys.custom-keybinding", true), backend, path);
  s.set_string("name", name);
  s.set_string("command", "true");
  s.set_string("binding", binding);
};
custom(customPaths[0], "Abrir terminal", "<Control><Alt>t");
custom(customPaths[1], "Sin asignar", ""); // un personalizado sin atajo no debe aparecer

const bindings = readSystemBindings({ schemaSource: source, backend });
const has = (accel, description) =>
  bindings.some((b) => b.accel === accel && b.description === description) ||
  fail(`falta {${accel}, ${description}} en ${JSON.stringify(bindings)}`);

has("<Super>Tab", "Cambiar de aplicación [Sistema]");
has("<Alt>Tab", "Cambiar de aplicación [Sistema]");
has("<Alt>F4", "Cerrar ventana [Sistema]");
has("<Super>v", "Mostrar la lista de notificaciones [Shell]");
has("<Super>m", "Mostrar la lista de notificaciones [Shell]");
has("<Super>Left", "Teselar a la izquierda [Sistema]");
has("<Super>Escape", "Restaurar atajos [Sistema]");
has("<Super>l", "Bloquear pantalla [Sistema]");
has("XF86AudioPlay", "Reproducir [Sistema]");
has("<Control><Alt>t", "Abrir terminal [Personalizado]");
if (bindings.some((b) => !b.accel)) fail("no debe haber entradas sin atajo");
if (bindings.some((b) => b.description.startsWith("Sin asignar"))) fail("un atajo personalizado vacío no debe contar");
if (bindings.some((b) => /volume-step|custom-keybindings/.test(b.description))) fail("solo las claves de atajos (tipo as), no el resto");

// Conflictos de extremo a extremo con el lector
const isKnownKey = () => true;
eq(findConflicts(parseAccelerator("<Super>l", isKnownKey, { allowReserved: true }), bindings), ["Bloquear pantalla [Sistema]"], "<Super>l");
eq(findConflicts(parseAccelerator("<Control><Alt>t", isKnownKey), bindings), ["Abrir terminal [Personalizado]"], "atajo del usuario");
eq(findConflicts(parseAccelerator("<Super><Shift>c", isKnownKey), bindings), [], "<Super><Shift>c libre");

// Esquemas ausentes (otra distro / sin gnome-settings-daemon): no es un error
const emptyDir = GLib.dir_make_tmp("knivchit-empty-XXXXXX");
GLib.file_set_contents(`${emptyDir}/otro.gschema.xml`, '<schemalist><schema id="org.ejemplo.Otro"><key name="x" type="i"><default>1</default></key></schema></schemalist>');
Gio.Subprocess.new(["glib-compile-schemas", "--strict", emptyDir], Gio.SubprocessFlags.NONE).wait(null);
const empty = Gio.SettingsSchemaSource.new_from_directory(emptyDir, null, false);
eq(readSystemBindings({ schemaSource: empty, backend }), [], "sin esquemas");

// Prueba de humo contra los esquemas REALES (solo si están instalados aquí)
const real = readSystemBindings({ backend: Gio.memory_settings_backend_new() }); // solo valores por defecto: no toca la configuración real
const realLock = real.find((b) => b.accel === "<Super>l");
print(realLock ? `INFO: esquemas reales: ${real.length} atajos; <Super>l = «${realLock.description}»` : "INFO: sin esquemas reales de GNOME en este equipo (se omite la prueba de humo)");

GLib.spawn_command_line_sync(`rm -rf ${tmp} ${emptyDir}`);
print("PASS: readSystemBindings lee atajos del sistema, del Shell, de mutter y los personalizados con descripciones legibles");
