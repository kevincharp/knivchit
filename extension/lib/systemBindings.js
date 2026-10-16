import Gio from "gi://Gio";

// Atajos que ya existen en el sistema, para avisar de conflictos antes de
// asignar uno a Knivchit. Solo lee GSettings (Gio): ni Shell ni Meta ni Main,
// así que se prueba con `gjs` a secas. No conoce los atajos que otras
// extensiones registran por su cuenta ni los de cada aplicación.

const MEDIA_KEYS = "org.gnome.settings-daemon.plugins.media-keys";
const CUSTOM_SCHEMA = `${MEDIA_KEYS}.custom-keybinding`;
const SOURCES = [
  { id: "org.gnome.desktop.wm.keybindings", origin: "Sistema" },
  { id: "org.gnome.mutter.keybindings", origin: "Sistema" },
  { id: "org.gnome.mutter.wayland.keybindings", origin: "Sistema" },
  { id: "org.gnome.shell.keybindings", origin: "Shell" },
  { id: MEDIA_KEYS, origin: "Sistema" },
];

/**
 * -> [{ accel, description }] con descripciones como «Bloquear pantalla
 * [Sistema]» (el resumen del propio esquema, ya traducido) y los atajos
 * personalizados del usuario como «<nombre> [Personalizado]».
 *
 * `schemaSource` y `backend` solo se cambian en las pruebas; por defecto se
 * leen los esquemas y la configuración reales. Un esquema que no esté
 * instalado se omite sin error.
 */
export function readSystemBindings({ schemaSource = Gio.SettingsSchemaSource.get_default(), backend = null } = {}) {
  const bindings = [];

  for (const { id, origin } of SOURCES) {
    const schema = schemaSource.lookup(id, true);
    if (!schema) continue;
    const settings = Gio.Settings.new_full(schema, backend, null);
    for (const name of schema.list_keys()) {
      const key = schema.get_key(name);
      // Solo las listas de aceleradores; custom-keybindings es una lista de rutas.
      if (name === "custom-keybindings" || key.get_value_type().dup_string() !== "as") continue;
      const description = `${key.get_summary() || name} [${origin}]`;
      for (const accel of settings.get_strv(name)) if (accel) bindings.push({ accel, description });
    }
  }

  const mediaSchema = schemaSource.lookup(MEDIA_KEYS, true);
  const customSchema = schemaSource.lookup(CUSTOM_SCHEMA, true);
  if (mediaSchema && customSchema) {
    const media = Gio.Settings.new_full(mediaSchema, backend, null);
    for (const path of media.get_strv("custom-keybindings")) {
      const custom = Gio.Settings.new_full(customSchema, backend, path);
      const accel = custom.get_string("binding");
      if (accel) bindings.push({ accel, description: `${custom.get_string("name") || "Atajo personalizado"} [Personalizado]` });
    }
  }

  return bindings;
}
