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

// R20: sin historial en la extensión: ni método, ni señal, ni forma de emitirla.
if (typeof service.GetHistory === "function" || typeof service.notifyChange === "function") {
  throw new Error("el servicio no debe exponer GetHistory ni notifyChange");
}

const [xml] = connection
  .call_sync(
    "org.knivchit.ClipboardService",
    "/org/knivchit/ClipboardService",
    "org.freedesktop.DBus.Introspectable",
    "Introspect",
    null,
    new GLib.VariantType("(s)"),
    Gio.DBusCallFlags.NONE,
    -1,
    null,
  )
  .deepUnpack();
for (const name of ["GetHistory", "HistoryChanged"]) {
  if (xml.includes(name)) throw new Error(`la introspección no debe contener ${name}`);
}

print("PASS: ClipboardService se registra en el bus sin GetHistory ni HistoryChanged");
