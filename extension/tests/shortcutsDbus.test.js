import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { authorizeBusCaller, ClipboardService } from "../lib/clipboardService.js";
import { ACTIONS, parseAccelerator, ShortcutManager } from "../lib/shortcuts.js";
import { ShortcutRecorder } from "../lib/shortcutRecorder.js";
import { PanelIconController } from "../lib/panelIcon.js";

// Corre con `dbus-run-session -- gjs -m extension/tests/shortcutsDbus.test.js`.
// Ejercita por un bus PRIVADO las firmas D-Bus que usará la app (backend):
//   GetShortcuts() -> a{ss}            acción -> acelerador ("" si no hay)
//   SetShortcut(s action, s accel) -> (b ok, s error)
//   CheckConflicts(s accel) -> as
//   RecordShortcut() -> (s accel, s status)   respuesta asíncrona (grab modal del Shell)

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};

const store = new Map(Object.values(ACTIONS).map((a) => [a.key, []]));
const shortcuts = new ShortcutManager({
  settings: { get_strv: (k) => [...store.get(k)], set_strv: (k, v) => store.set(k, [...v]) },
  isKnownKey: (name) => /^[a-z]$|^F\d+$|^space$/.test(name),
  systemBindings: () => [{ accel: "<Super>l", description: "Bloquear la pantalla [Sistema]" }],
});

const connection = Gio.DBusConnection.new_for_address_sync(
  GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
  Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
  null,
  null,
);
// El grab del Shell se simula: lo que se comprueba es que SIEMPRE se libera.
const grabLog = { grabs: 0, releases: 0 };
const recorder = new ShortcutRecorder({
  grab: () => { grabLog.grabs++; return () => { grabLog.releases++; }; },
  setTimer: (ms, cb) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { cb(); return GLib.SOURCE_REMOVE; }),
  clearTimer: (id) => GLib.Source.remove(id),
  parse: (raw) => parseAccelerator(raw, (name) => /^[a-z]$|^F\d+$|^space$|^Tab$|^Escape$/.test(name)),
  timeoutMs: 600,
  cooldownMs: 0,
});
const panelState = { enabled: true, created: 0, destroyed: 0, handler: null };
const panelIcon = new PanelIconController({
  settings: {
    get_boolean: () => panelState.enabled,
    set_boolean: (_k, v) => { panelState.enabled = v; panelState.handler?.(); },
    connect: (_s, cb) => { panelState.handler = cb; return 1; },
    disconnect: () => { panelState.handler = null; },
  },
  createIcon: () => { panelState.created++; return {}; },
  destroyIcon: () => { panelState.destroyed++; },
  appRunning: true, // el servicio solo atiende a la app, que por definición está en marcha
});
panelIcon.start();
const service = new ClipboardService({ shortcuts, recorder, panelIcon, authorize: authorizeBusCaller(connection) });
service.export(connection, "/org/knivchit/ClipboardService");

// La llamada va por una segunda conexión: ida y vuelta real por el bus.
const client = Gio.DBusConnection.new_for_address_sync(
  GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
  Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
  null,
  null,
);
connection.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
  new GLib.Variant("(su)", ["org.knivchit.ClipboardService", 0]), null, Gio.DBusCallFlags.NONE, -1, null);

// call_sync bloquearía el bucle que atiende al servicio (misma hebra): se
// llama con la variante asíncrona y se espera con un MainLoop.
const loop = new GLib.MainLoop(null, false);
const call = (method, params, replyType) => {
  let result = null;
  client.call(
    "org.knivchit.ClipboardService", "/org/knivchit/ClipboardService", "org.knivchit.ClipboardService",
    method, params, new GLib.VariantType(replyType), Gio.DBusCallFlags.NONE, 5000, null,
    (c, res) => {
      try {
        result = c.call_finish(res);
      } catch (e) {
        result = e;
      }
      loop.quit();
    },
  );
  loop.run();
  if (!result || typeof result.deepUnpack !== "function") fail(`${method} falló: ${result?.message ?? result}`);
  return result;
};

// --- Autorización del que llama (EXT-01) ------------------------------------------------------------
// Solo el dueño de org.knivchit.App (o su proceso) puede usar los métodos de atajos. Los clientes
// «ajenos» son procesos gdbus aparte (otro PID); los de este proceso hacen de aplicación.
const IFACE = "org.knivchit.ClipboardService";
const rawCall = (conn, method, params, replyType = "(a{ss})") => {
  let out = null;
  conn.call(IFACE, "/org/knivchit/ClipboardService", IFACE, method, params, new GLib.VariantType(replyType),
    Gio.DBusCallFlags.NONE, 5000, null, (c, res) => {
      try { out = c.call_finish(res).deepUnpack(); } catch (e) { out = e; }
      loop.quit();
    });
  loop.run();
  return out;
};
const foreign = (method, args = []) => {
  let result = null;
  const proc = Gio.Subprocess.new(
    ["gdbus", "call", "--session", "--dest", IFACE, "--object-path", "/org/knivchit/ClipboardService", "--method", `${IFACE}.${method}`, ...args],
    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
  proc.communicate_utf8_async(null, null, (p, res) => {
    const [, stdout, stderr] = p.communicate_utf8_finish(res);
    result = { ok: p.get_successful(), stdout, stderr };
    loop.quit();
  });
  loop.run();
  return result;
};
const denied = (r, label) => {
  if (r.ok || !/AccessDenied/.test(r.stderr)) fail(`${label}: debía rechazarse con AccessDenied y dio ${JSON.stringify(r)}`);
};

// 0. Sin la aplicación en el bus nadie es «la app»: todo se rechaza.
{
  const r = rawCall(client, "GetShortcuts", null);
  if (typeof r?.message !== "string" || !/AccessDenied/.test(r.message)) fail(`sin app en el bus debía dar AccessDenied: ${r}`);
}
// La aplicación toma su nombre desde una conexión; las llamadas a la extensión las hace OTRA conexión del mismo
// proceso (como la app real: zbus abre una segunda), así que la identidad se decide por proceso, no por nombre.
const appConn = Gio.DBusConnection.new_for_address_sync(
  GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
  Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
appConn.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
  new GLib.Variant("(su)", ["org.knivchit.App", 0]), null, Gio.DBusCallFlags.NONE, -1, null);

// 1. Un proceso ajeno del mismo usuario es rechazado en los cuatro métodos y NO cambia nada.
{
  const grabsBefore = grabLog.grabs;
  denied(foreign("GetShortcuts"), "GetShortcuts ajeno");
  denied(foreign("SetShortcut", ["capture", "<Super><Shift>x"]), "SetShortcut ajeno");
  denied(foreign("CheckConflicts", ["<Super>l"]), "CheckConflicts ajeno");
  denied(foreign("RecordShortcut"), "RecordShortcut ajeno");
  denied(foreign("GetPanelIcon"), "GetPanelIcon ajeno");
  denied(foreign("SetPanelIcon", ["false"]), "SetPanelIcon ajeno");
  eq([panelState.enabled, panelState.destroyed], [true, 0], "un ajeno no quita el icono de la barra");
  eq([grabLog.grabs, recorder.recording], [grabsBefore, false], "un ajeno no toma el grab modal");
  eq(store.get("knivchit-start-capture"), [], "un ajeno no reasigna el atajo");
  // «Bucle» de DoS: varias llamadas seguidas, ninguna llega al grabador
  for (let i = 0; i < 5; i++) denied(foreign("RecordShortcut"), `RecordShortcut ajeno #${i}`);
  eq(grabLog.grabs, grabsBefore, "ni en bucle");
}

// --- Icono de la barra superior: GetPanelIcon/SetPanelIcon ------------------------------------------
{
  eq(call("GetPanelIcon", null, "(b)").deepUnpack(), [true], "GetPanelIcon: activado por defecto");
  eq(panelState.created, 1, "hay un icono creado");
  eq(call("SetPanelIcon", new GLib.Variant("(b)", [false]), "(bs)").deepUnpack(), [true, ""], "SetPanelIcon(false)");
  eq([panelState.enabled, panelState.destroyed], [false, 1], "SetPanelIcon(false) quita el icono y persiste");
  eq(call("GetPanelIcon", null, "(b)").deepUnpack(), [false], "GetPanelIcon tras desactivar");
  eq(call("SetPanelIcon", new GLib.Variant("(b)", [true]), "(bs)").deepUnpack(), [true, ""], "SetPanelIcon(true)");
  eq([panelState.enabled, panelState.created], [true, 2], "SetPanelIcon(true) lo vuelve a crear, una vez");
  call("SetPanelIcon", new GLib.Variant("(b)", [true]), "(bs)");
  eq(panelState.created, 2, "activar estando activado no duplica");
}

// GetShortcuts: nada asignado por defecto
let r = call("GetShortcuts", null, "(a{ss})");
eq(r.deepUnpack()[0], { capture: "", emoji: "", clipboard: "" }, "GetShortcuts inicial");

// SetShortcut: ok
r = call("SetShortcut", new GLib.Variant("(ss)", ["capture", "<Super><Shift>C"]), "(bs)");
eq(r.deepUnpack(), [true, ""], "SetShortcut ok");
eq(call("GetShortcuts", null, "(a{ss})").deepUnpack()[0].capture, "<Super><Shift>c", "GetShortcuts tras asignar");

// SetShortcut: error de validación (ok=false con motivo, NO un error D-Bus)
r = call("SetShortcut", new GLib.Variant("(ss)", ["capture", "c"]), "(bs)");
const [ok, error] = r.deepUnpack();
if (ok || !error.includes("modificador")) fail(`SetShortcut inválido: [${ok}, «${error}»]`);
eq(call("GetShortcuts", null, "(a{ss})").deepUnpack()[0].capture, "<Super><Shift>c", "un error no cambia lo guardado");
r = call("SetShortcut", new GLib.Variant("(ss)", ["nueva", "<Super>c"]), "(bs)");
if (r.deepUnpack()[0]) fail("una acción desconocida debe rechazarse");

// CheckConflicts
eq(call("CheckConflicts", new GLib.Variant("(s)", ["<Super>l"]), "(as)").deepUnpack()[0], ["Bloquear la pantalla [Sistema]"], "CheckConflicts con conflicto");
eq(call("CheckConflicts", new GLib.Variant("(s)", ["<Super><Shift>c"]), "(as)").deepUnpack()[0], [], "CheckConflicts libre");
eq(call("CheckConflicts", new GLib.Variant("(s)", ["<<basura"]), "(as)").deepUnpack()[0], [], "CheckConflicts inválido");

// Quitar
eq(call("SetShortcut", new GLib.Variant("(ss)", ["capture", ""]), "(bs)").deepUnpack(), [true, ""], "quitar");
eq(call("GetShortcuts", null, "(a{ss})").deepUnpack()[0].capture, "", "GetShortcuts tras quitar");

// --- RecordShortcut -------------------------------------------------------------------------------
// Llamada asíncrona que se resuelve cuando el Shell entrega la combinación. La llamada se hace SIN
// bloquear el bucle (el servicio vive en este mismo proceso) y las pulsaciones se simulan con un
// temporizador, igual que lo haría el actor modal del Shell.
const startCall = (conn, onDone) =>
  conn.call("org.knivchit.ClipboardService", "/org/knivchit/ClipboardService", "org.knivchit.ClipboardService",
    "RecordShortcut", null, new GLib.VariantType("(ss)"), Gio.DBusCallFlags.NONE, 5000, null, (c, res) => {
      try { onDone(c.call_finish(res).deepUnpack()); } catch (e) { onDone(e); }
    });
const after = (ms, fn) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { fn(); return GLib.SOURCE_REMOVE; });
const press = (keyName, mods = []) => recorder.key({ keyName, mods, isModifier: false });

// 1. firma y resultado normal
{
  let reply = null;
  startCall(client, (r) => { reply = r; loop.quit(); });
  after(150, () => press("c", ["Control", "Alt"]));
  loop.run();
  eq(reply, ["<Control><Alt>c", "ok"], "RecordShortcut devuelve (accel, status)");
  eq([grabLog.grabs, grabLog.releases, recorder.recording], [1, 1, false], "el grab se tomó y se liberó");
}
// 2. Esc cancela; una segunda llamada concurrente responde busy sin tocar la primera
{
  let first = null, second = null;
  startCall(client, (r) => { first = r; loop.quit(); });
  after(150, () => startCall(client, (r) => { second = r; }));
  after(400, () => press("Escape"));
  loop.run();
  eq(second, ["", "busy"], "la segunda llamada recibe busy");
  eq(first, ["", "cancelled"], "Esc cancela la primera");
  eq([grabLog.grabs, grabLog.releases], [2, 2], "un solo grab por grabación y todos liberados");
}
// 3. combinación inválida: status invalid con el motivo
{
  let reply = null;
  startCall(client, (r) => { reply = r; loop.quit(); });
  after(150, () => press("c", []));
  loop.run();
  eq(reply[1], "invalid", "tecla sola => invalid");
  if (!reply[0].includes("modificador")) fail(`el motivo debería mencionar el modificador: ${reply[0]}`);
}
// 4. tiempo máximo (600 ms en esta prueba)
{
  let reply = null;
  startCall(client, (r) => { reply = r; loop.quit(); });
  loop.run();
  eq(reply, ["", "timeout"], "sin pulsar nada vence el tiempo");
  eq([recorder.recording, grabLog.releases], [false, 4], "el timeout libera el grab");
}
// 5. el cliente D-Bus desaparece en mitad de la grabación: se libera el grab
{
  const gone = Gio.DBusConnection.new_for_address_sync(
    GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
  const before = grabLog.releases;
  startCall(gone, () => {});
  after(200, () => { if (!recorder.recording) fail("la grabación debería estar en curso"); gone.close_sync(null); });
  // Se espera solo a que el grab se libere: si ocurriera por el temporizador (600 ms) y no por la
  // desaparición del cliente, el tiempo medido lo delata.
  const t0 = GLib.get_monotonic_time();
  const poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
    if (!recorder.recording && grabLog.releases > before) { loop.quit(); return GLib.SOURCE_REMOVE; }
    return GLib.SOURCE_CONTINUE;
  });
  after(1500, () => loop.quit()); // red de seguridad: que la prueba no se cuelgue si falla
  loop.run();
  GLib.Source.remove(poll);
  const elapsedMs = (GLib.get_monotonic_time() - t0) / 1000;
  eq([recorder.recording, grabLog.releases], [false, before + 1], "al desaparecer el cliente se libera el grab");
  if (elapsedMs > 560) fail(`se liberó por el temporizador (${elapsedMs.toFixed(0)} ms), no por la desaparición del cliente`);
}
// 6. sin grabador (no debería pasar en producción): unavailable, sin error D-Bus
{
  const lonely = new ClipboardService({ shortcuts, authorize: async () => ({ ok: true, reason: "" }) });
  const c2 = Gio.DBusConnection.new_for_address_sync(
    GLib.getenv("DBUS_SESSION_BUS_ADDRESS"),
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
  lonely.export(c2, "/org/knivchit/Otro");
  let reply = null;
  c2.call(c2.get_unique_name(), "/org/knivchit/Otro", "org.knivchit.ClipboardService", "RecordShortcut", null,
    new GLib.VariantType("(ss)"), Gio.DBusCallFlags.NONE, 3000, null, (c, res) => { try { reply = c.call_finish(res).deepUnpack(); } catch (e) { reply = e; } loop.quit(); });
  loop.run();
  eq(reply, ["", "unavailable"], "sin grabador => unavailable");
  lonely.unexport();
}

// Lo anterior del servicio no se rompe
eq(call("GetHistory", null, "(aa{sv})").deepUnpack()[0], [], "GetHistory sigue vacío");

print("PASS: ClipboardService expone GetShortcuts/SetShortcut/CheckConflicts/RecordShortcut con las firmas acordadas por el bus y libera el grab si el cliente desaparece");
