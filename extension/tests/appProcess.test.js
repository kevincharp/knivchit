import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { watchAppProcess } from "../lib/clipboardService.js";

// Corre con `dbus-run-session -- gjs -m extension/tests/appProcess.test.js` (bus privado).
// watchAppProcess informa del PID del dueño de org.knivchit.App (null si no hay): con él la
// extensión comprueba que una ventana titulada «Knivchit» es de la app y no de otro programa.

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
const pump = (ms) => {
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { loop.quit(); return GLib.SOURCE_REMOVE; });
  loop.run();
};
const myPid = Number(GLib.file_get_contents("/proc/self/stat")[1].toString().split(" ")[0]);

const seen = [];
const watcher = bus();
const unwatch = watchAppProcess(watcher, (pid) => seen.push(pid));
pump(300);
eq(seen, [], "sin la app en el bus no hay cambios (el estado inicial ya es null)");

const app = bus();
app.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
  new GLib.Variant("(su)", ["org.knivchit.App", 0]), null, Gio.DBusCallFlags.NONE, -1, null);
pump(400);
eq(seen, [myPid], "al aparecer la app se informa de su PID");

app.close_sync(null);
pump(400);
eq(seen, [myPid, null], "al desaparecer la app el PID vuelve a null");

unwatch();
const again = bus();
again.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
  new GLib.Variant("(su)", ["org.knivchit.App", 0]), null, Gio.DBusCallFlags.NONE, -1, null);
pump(300);
eq(seen.length, 2, "tras unwatch no se informa más");

print("PASS: watchAppProcess informa del PID del dueño de org.knivchit.App y de su desaparición");
