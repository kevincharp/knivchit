import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { ClipboardService } from "../lib/clipboardService.js";

// Corre con `gjs -m` contra un bus de sesión PRIVADO (dbus-launch), nunca el
// bus real de la máquina: `dbus-run-session -- gjs -m extension/tests/<nombre>.test.js`.

const service = new ClipboardService({ authorize: async () => ({ ok: true, reason: "" }) });
const connection = Gio.DBusConnection.new_for_address_sync(
  GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
  Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
  null,
  null,
);

service.export(connection, "/org/knivchit/ClipboardService");

connection.call_sync(
  "org.freedesktop.DBus",
  "/org/freedesktop/DBus",
  "org.freedesktop.DBus",
  "RequestName",
  new GLib.Variant("(su)", ["org.knivchit.ClipboardService", 0]),
  null,
  Gio.DBusCallFlags.NONE,
  -1,
  null,
);

const history = service.GetHistory();
if (!Array.isArray(history)) {
  throw new Error("GetHistory no devolvió un array");
}
if (history.length !== 0) {
  throw new Error("el historial debería arrancar vacío");
}

print("PASS: ClipboardService se registra en el bus y GetHistory devuelve un array");
