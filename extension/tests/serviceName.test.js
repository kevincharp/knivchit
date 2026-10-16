import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { requestServiceName, SERVICE_BUS_NAME } from "../lib/clipboardService.js";

// Corre con `dbus-run-session -- gjs -m extension/tests/serviceName.test.js` (bus privado).
// EXT-05: la extensión pide su nombre SIN cola; si un okupa lo tiene, falla de forma explícita.

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};
const bus = () =>
  Gio.DBusConnection.new_for_address_sync(
    GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
const loop = new GLib.MainLoop(null, false);
const request = (conn) => {
  let out = null;
  requestServiceName(conn, (r) => { out = r; loop.quit(); });
  loop.run();
  return out;
};
const dbusCall = (conn, method, params, type) =>
  conn.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", method, params,
    type ? new GLib.VariantType(type) : null, Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
const owner = () => {
  try { return dbusCall(bus(), "GetNameOwner", new GLib.Variant("(s)", [SERVICE_BUS_NAME]), "(s)")[0]; } catch { return null; }
};

// 1. Nombre libre: lo obtiene.
const ext = bus();
eq(request(ext).owned, true, "con el nombre libre la extensión lo obtiene");
eq(owner(), ext.get_unique_name(), "el dueño es la extensión");

// 2. Reinicio normal (disable + enable): ReleaseName y volver a pedir en la misma conexión.
dbusCall(ext, "ReleaseName", new GLib.Variant("(s)", [SERVICE_BUS_NAME]), "(u)");
eq(owner(), null, "tras ReleaseName nadie tiene el nombre");
eq(request(ext).owned, true, "el reinicio normal recupera el nombre");
// ...y pedirlo estando ya dueña no es un fallo.
eq(request(ext).owned, true, "pedirlo dos veces seguidas sigue siendo válido");
dbusCall(ext, "ReleaseName", new GLib.Variant("(s)", [SERVICE_BUS_NAME]), "(u)");

// 3. Un okupa llegó antes: la petición falla en el acto y NO queda en cola.
const squatter = bus();
dbusCall(squatter, "RequestName", new GLib.Variant("(su)", [SERVICE_BUS_NAME, 0]), "(u)");
const denied = request(ext);
eq(denied.owned, false, "con un okupa la extensión NO obtiene el nombre");
eq(denied.code, 3, "el bus responde EXISTS (3), no IN_QUEUE (2)");
eq(owner(), squatter.get_unique_name(), "el okupa conserva el nombre");

// 4. Si el okupa desaparece, la extensión no hereda el nombre en silencio (no estaba en cola).
squatter.close_sync(null);
GLib.usleep(300000);
eq(owner(), null, "al morir el okupa el nombre queda libre, no pasa a la extensión");

print("PASS: la extensión pide su nombre sin cola (DO_NOT_QUEUE): falla explícito ante un okupa, no se encola y el reinicio normal sigue funcionando");
