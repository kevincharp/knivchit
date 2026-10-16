import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { APP_BUS_NAME, authorizeCaller } from "./callerAuth.js";

// Lógica pura del servicio D-Bus de la extensión (historial de portapapeles,
// aún sin función, y atajos de teclado). NUNCA importa gi://Shell, gi://Meta
// ni Main — eso es lo que permite testear este archivo con `gjs -m` a secas,
// fuera del proceso real de GNOME Shell. El contrato D-Bus está resumido en extension/README.md.

const IFACE_XML = `
<node>
  <interface name="org.knivchit.ClipboardService">
    <method name="GetHistory">
      <arg type="aa{sv}" direction="out" name="entries"/>
    </method>
    <signal name="HistoryChanged">
      <arg type="a{sv}" name="entry"/>
    </signal>
    <method name="GetShortcuts">
      <arg type="a{ss}" direction="out" name="shortcuts"/>
    </method>
    <method name="SetShortcut">
      <arg type="s" direction="in" name="action"/>
      <arg type="s" direction="in" name="accel"/>
      <arg type="b" direction="out" name="ok"/>
      <arg type="s" direction="out" name="error"/>
    </method>
    <method name="CheckConflicts">
      <arg type="s" direction="in" name="accel"/>
      <arg type="as" direction="out" name="conflicts"/>
    </method>
    <method name="GetPanelIcon">
      <arg type="b" direction="out" name="enabled"/>
    </method>
    <method name="SetPanelIcon">
      <arg type="b" direction="in" name="enabled"/>
      <arg type="b" direction="out" name="ok"/>
      <arg type="s" direction="out" name="error"/>
    </method>
    <method name="RecordShortcut">
      <arg type="s" direction="out" name="accel"/>
      <arg type="s" direction="out" name="status"/>
    </method>
  </interface>
</node>`;

export class ClipboardService {
  // `shortcuts`: el ShortcutManager de lib/shortcuts.js y `recorder`: el
  // ShortcutRecorder de lib/shortcutRecorder.js (los crea extension.js, que es
  // quien conoce el GSettings y el Shell).
  // `authorize(sender) -> Promise<{ok, reason}>`: ver authorizeBusCaller.
  constructor({ shortcuts = null, recorder = null, panelIcon = null, authorize }) {
    if (typeof authorize !== "function") throw new Error("ClipboardService necesita authorize()");
    this._authorize = authorize;
    this._history = [];
    this._shortcuts = shortcuts;
    this._recorder = recorder;
    this._panelIcon = panelIcon;
    this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
  }

  export(connection, objectPath) {
    this._dbusImpl.export(connection, objectPath);
  }

  unexport() {
    this._dbusImpl.unexport();
  }

  GetHistory() {
    return this._history.map((entry) => ({
      content_type: new GLib.Variant("s", entry.content_type),
      content: new GLib.Variant("s", entry.content),
    }));
  }

  // Los cuatro métodos de atajos solo los atiende al dueño de org.knivchit.App
  // (callerAuth.js). Cualquier otro recibe AccessDenied: no puede reasignar
  // atajos ni tomar el grab modal del Shell.
  _guarded(invocation, run) {
    this._authorize(invocation.get_sender())
      .then(({ ok, reason }) => {
        if (!ok) {
          invocation.return_dbus_error("org.freedesktop.DBus.Error.AccessDenied", `Knivchit: ${reason}`);
          return;
        }
        run();
      })
      .catch((e) => {
        invocation.return_dbus_error("org.freedesktop.DBus.Error.Failed", `Knivchit: ${e.message ?? e}`);
      });
  }

  // Acción -> acelerador GTK ("" si no hay ninguno asignado).
  GetShortcutsAsync(_params, invocation) {
    this._guarded(invocation, () =>
      invocation.return_value(new GLib.Variant("(a{ss})", [this._shortcuts?.getShortcuts() ?? {}])),
    );
  }

  // [ok, error]: la validación falla con ok=false y un motivo legible, no con
  // un error D-Bus. Un acelerador vacío quita el atajo.
  SetShortcutAsync([action, accel], invocation) {
    this._guarded(invocation, () => {
      const result = this._shortcuts?.setShortcut(action, accel) ?? [false, "Los atajos no están disponibles."];
      invocation.return_value(new GLib.Variant("(bs)", result));
    });
  }

  // Descripciones legibles de los atajos del sistema que chocan con `accel`.
  CheckConflictsAsync([accel], invocation) {
    this._guarded(invocation, () =>
      invocation.return_value(new GLib.Variant("(as)", [this._shortcuts?.checkConflicts(accel) ?? []])),
    );
  }

  // Icono opcional de la barra superior (lib/panelIcon.js): consulta y cambio, con
  // la misma autenticación que los atajos. Sin controlador devuelve «no disponible».
  GetPanelIconAsync(_params, invocation) {
    this._guarded(invocation, () =>
      invocation.return_value(new GLib.Variant("(b)", [this._panelIcon?.isEnabled() ?? false])),
    );
  }

  SetPanelIconAsync([enabled], invocation) {
    this._guarded(invocation, () => {
      const result = this._panelIcon?.setEnabled(enabled) ?? [false, "El icono de la barra superior no está disponible."];
      invocation.return_value(new GLib.Variant("(bs)", result));
    });
  }

  // Graba UNA combinación con el teclado capturado por el Shell y la devuelve
  // como (accel, status); respuesta asíncrona. Si quien llama desaparece del
  // bus a mitad, se aborta la grabación para liberar el grab.
  RecordShortcutAsync(_params, invocation) {
    this._guarded(invocation, () => {
      if (!this._recorder) {
        invocation.return_value(new GLib.Variant("(ss)", ["", "unavailable"]));
        return;
      }
      const watch = Gio.bus_watch_name_on_connection(
        invocation.get_connection(),
        invocation.get_sender(),
        Gio.BusNameWatcherFlags.NONE,
        null,
        () => this._recorder.abort(),
      );
      this._recorder.begin((accel, status) => {
        Gio.bus_unwatch_name(watch);
        invocation.return_value(new GLib.Variant("(ss)", [accel, status]));
      });
    });
  }

  // Llamado por extension.js cuando St.Clipboard reporta un cambio real.
  notifyChange(entry) {
    this._history.unshift(entry);
    this._dbusImpl.emit_signal(
      "HistoryChanged",
      new GLib.Variant("(a{sv})", [
        {
          content_type: new GLib.Variant("s", entry.content_type),
          content: new GLib.Variant("s", entry.content),
        },
      ]),
    );
  }
}

// Autorizador real: consulta al bus (GetNameOwner / GetConnectionCredentials).
export function authorizeBusCaller(connection) {
  const busCall = (method, params, replyType) =>
    new Promise((resolve, reject) => {
      connection.call(
        "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", method, params,
        new GLib.VariantType(replyType), Gio.DBusCallFlags.NONE, 2000, null,
        (c, res) => {
          try {
            resolve(c.call_finish(res).deepUnpack());
          } catch (e) {
            reject(e);
          }
        },
      );
    });
  const deps = {
    ownerOf: async (name) => {
      try {
        return (await busCall("GetNameOwner", new GLib.Variant("(s)", [name]), "(s)"))[0];
      } catch {
        return null; // NameHasNoOwner
      }
    },
    credentialsOf: async (unique) => {
      try {
        const [info] = await busCall("GetConnectionCredentials", new GLib.Variant("(s)", [unique]), "(a{sv})");
        return { pid: info.ProcessID?.deepUnpack() ?? null, uid: info.UnixUserID?.deepUnpack() ?? null };
      } catch {
        return null;
      }
    },
  };
  deps.ownUid = async () => (await deps.credentialsOf(connection.get_unique_name()))?.uid ?? -1;
  return (sender) => authorizeCaller(sender, deps);
}

// Nombre del servicio en el bus de sesión.
export const SERVICE_BUS_NAME = "org.knivchit.ClipboardService";

// Códigos de respuesta de RequestName (org.freedesktop.DBus).
const NAME_PRIMARY_OWNER = 1;
const NAME_ALREADY_OWNER = 4;
const FLAG_DO_NOT_QUEUE = 4;

/**
 * Pide SERVICE_BUS_NAME SIN entrar en la cola de espera (DO_NOT_QUEUE): si otro
 * proceso ya lo tiene (un okupa que llegó antes, EXT-05) la petición falla en el
 * acto y, aunque ese proceso muera después, la extensión no hereda el nombre
 * sin que nadie lo note. `onResult({ owned, code })` se llama una vez; `owned`
 * es false también si la llamada al bus falla.
 */
export function requestServiceName(connection, onResult) {
  connection.call(
    "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
    new GLib.Variant("(su)", [SERVICE_BUS_NAME, FLAG_DO_NOT_QUEUE]), new GLib.VariantType("(u)"),
    Gio.DBusCallFlags.NONE, -1, null,
    (c, res) => {
      let code = 0;
      try {
        code = c.call_finish(res).deepUnpack()[0];
      } catch (e) {
        console.error(`Knivchit: RequestName falló: ${e.message ?? e}`);
      }
      onResult({ owned: code === NAME_PRIMARY_OWNER || code === NAME_ALREADY_OWNER, code });
    },
  );
}

// Vigila quién es el dueño de org.knivchit.App y llama a `onChange(pid)` con el PID de su proceso
// (o null cuando la app no está en el bus). Sirve para comprobar que una ventana titulada
// «Knivchit» es de verdad de la app. Devuelve la función que deja de vigilar.
export function watchAppProcess(connection, onChange) {
  let current = null;
  const set = (pid) => {
    if (pid !== current) {
      current = pid;
      onChange(pid);
    }
  };
  const id = Gio.bus_watch_name_on_connection(
    connection,
    APP_BUS_NAME,
    Gio.BusNameWatcherFlags.NONE,
    (conn, _name, owner) => {
      conn.call(
        "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionCredentials",
        new GLib.Variant("(s)", [owner]), new GLib.VariantType("(a{sv})"), Gio.DBusCallFlags.NONE, 2000, null,
        (c, res) => {
          try {
            const [info] = c.call_finish(res).deepUnpack();
            set(info.ProcessID?.deepUnpack() ?? null);
          } catch {
            set(null);
          }
        },
      );
    },
    () => set(null),
  );
  return () => Gio.bus_unwatch_name(id);
}
