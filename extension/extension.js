import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import { Extension, InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { PanelIconController } from "./lib/panelIcon.js";
import { decideCallAppOutcome } from "./lib/callAppRetry.js";
import { authorizeBusCaller, ClipboardService, requestServiceName, SERVICE_BUS_NAME, watchAppProcess } from "./lib/clipboardService.js";
import { ShortcutRecorder } from "./lib/shortcutRecorder.js";
import { isModifierKeysym, parseAccelerator, ShortcutManager } from "./lib/shortcuts.js";
import { readSystemBindings } from "./lib/systemBindings.js";
import { isCaptureOverlayTitle, isMainWindowTitle, isOwnedByApp, isPinWindowTitle } from "./lib/windowMatch.js";
import { placeMainWindow } from "./lib/windowPlacement.js";

// Glue del Shell. Este archivo (y solo este) puede importar gi://Shell,
// gi://Meta y Main — por eso no lleva test unitario, se verifica a mano en
// una sesión GNOME real (el Shell anidado). La lógica que se puede probar sin el Shell vive
// en lib/, que nunca importa Shell, Meta ni Main.

// Cuánto se vigila la posición de una ventana X11 recién colocada.
const HOLD_PLACEMENT_MS = 1500;
const CAPTURE_KEYBINDING_NAME = "knivchit-start-capture";

export default class KnivchitExtension extends Extension {
  enable() {
    this._active = true;
    this._appPid = null; // PID del dueño de org.knivchit.App (null = la app no está en el bus)
    this._retryIds = new Set();
    this._idleIds = new Set();
    this._settings = this.getSettings();
    // Los atajos los gestiona la extensión; la app los lee y los cambia por
    // D-Bus (GetShortcuts/SetShortcut/CheckConflicts/RecordShortcut). Clutter
    // dice si una tecla existe (Gtk no se puede importar en el Shell): no tiene
    // keyval_from_name, pero exporta una constante KEY_<nombre> por cada tecla
    // (y GTK/GDK quitan el prefijo XF86 de las teclas multimedia).
    const isKnownKey = (name) => {
      const keyval = Clutter[`KEY_${name}`] ?? Clutter[`KEY_${name.replace(/^XF86/, "")}`];
      return typeof keyval === "number" && keyval !== Clutter.KEY_VoidSymbol;
    };
    this._shortcuts = new ShortcutManager({
      settings: this._settings,
      isKnownKey,
      systemBindings: () => readSystemBindings(),
    });
    // Lo que ya haya en GSettings (heredado de la extensión anterior, o escrito en dconf
    // por cualquier proceso sin pasar por D-Bus) se somete a las mismas reglas que
    // SetShortcut, ahora y en cada cambio: un valor reservado se vacía en vez de ligarse.
    this._shortcuts.sanitize();
    this._settingsChangedId = this._settings.connect("changed", () => this._shortcuts?.sanitize());
    // Grabación de una combinación con el teclado capturado por el Shell: ver
    // lib/shortcutRecorder.js (se libera siempre: tiempo, Esc, clic, cliente
    // desaparecido y disable()).
    this._recorder = new ShortcutRecorder({
      grab: () => this._grabKeyboard(),
      setTimer: (ms, cb) =>
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
          cb();
          return GLib.SOURCE_REMOVE;
        }),
      clearTimer: (id) => GLib.Source.remove(id),
      parse: (raw) => parseAccelerator(raw, isKnownKey),
    });
    // Icono opcional de la barra superior: un clic abre la ventana principal (ShowMain).
    this._panelIcon = new PanelIconController({
      settings: this._settings,
      createIcon: () => this._createPanelIcon(),
      destroyIcon: (button) => button?.destroy(),
      appRunning: this._appPid !== null,
    });
    this._service = new ClipboardService({
      shortcuts: this._shortcuts,
      recorder: this._recorder,
      panelIcon: this._panelIcon,
      authorize: authorizeBusCaller(Gio.DBus.session),
    });
    this._service.export(Gio.DBus.session, "/org/knivchit/ClipboardService");
    // Sin cola (DO_NOT_QUEUE): si otro proceso ya tiene el nombre, no se disimula —se
    // avisa y se retira el objeto exportado, para no servir nada bajo un nombre ajeno.
    requestServiceName(Gio.DBus.session, ({ owned, code }) => {
      if (!this._active || owned) return;
      console.error(`Knivchit: ${SERVICE_BUS_NAME} ya lo tiene otro proceso (código ${code}); los atajos no estarán disponibles.`);
      Main.notify("Knivchit", "Otro proceso ya ocupa el servicio de atajos de Knivchit; los atajos no están disponibles.");
      this._service?.unexport();
      this._serviceExported = false;
    });
    this._serviceExported = true;

    this._panelIcon.start();

    // El atajo global lo registra la extensión porque ya corre privilegiada
    // dentro del Shell — no depende de la madurez del portal GlobalShortcuts.
    // Viene VACÍO: Knivchit no fija ningún atajo, el usuario lo elige en la
    // Configuración de la app (SetShortcut escribe esta clave de GSettings y
    // Mutter la religa en vivo). Al pulsarlo se llama a
    // org.knivchit.App.StartCapture por D-Bus (la app lo implementa vía zbus,
    // ver app/src-tauri/src/dbus/mod.rs). No hay atajo de portapapeles: no va
    // en la v0.1 y extensions.gnome.org prohíbe atajos por defecto sobre él.
    Main.wm.addKeybinding(
      CAPTURE_KEYBINDING_NAME,
      this._settings,
      Meta.KeyBindingFlags.NONE,
      // Solo en uso normal y vista general: nunca en la pantalla de bloqueo ni
      // con un grab modal de otro (ActionMode.ALL los incluía).
      Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
      () => this._startCapture(),
    );

    // GNOME ignora always_on_top de las apps Wayland: la extensión, que ya es
    // compositor, mantiene encima las ventanas pin. Solo mira títulos; no
    // sabe qué contienen ni habla con la app.
    // La ventana principal («Knivchit») se coloca a la derecha del monitor
    // primario UNA vez por ventana creada: bajo Wayland la app no puede
    // posicionarse sola. Si el usuario la arrastra después, se respeta.
    this._placed = new WeakSet();
    this._holds = new Map();
    // La ventana principal solo se coloca y se activa si su proceso es el de la app: cualquier
    // programa puede ponerle el título «Knivchit» a una ventana. El PID del dueño de
    // org.knivchit.App llega de forma asíncrona; al conocerlo se revisan las ventanas ya vistas.
    this._unwatchApp = watchAppProcess(Gio.DBus.session, (pid) => {
      this._appPid = pid;
      this._panelIcon?.setAppRunning(pid !== null); // el icono solo existe con la app en marcha
      if (pid !== null) for (const win of [...(this._titleHandlers?.keys() ?? [])]) this._placeMainWindow(win);
    });
    // Sin animación de mapeo/cierre/minimizado para el overlay de captura (y solo para él, por
    // título exacto). WindowManager consulta _shouldAnimateActor antes de cada animación; el
    // InjectionManager oficial restaura el original al deshabilitar. Es API privada del Shell:
    // si desapareciera, overrideMethod no la encuentra y el único efecto es volver a ver la animación.
    this._injections = new InjectionManager();
    this._injections.overrideMethod(Main.wm, "_shouldAnimateActor", (original) =>
      function (actor, types) {
        if (isCaptureOverlayTitle(actor?.meta_window?.get_title())) {
          this._skippedActors?.delete(actor);
          return false;
        }
        return original.call(this, actor, types);
      },
    );
    this._titleHandlers = new Map();
    this._windowCreatedId = global.display.connect("window-created", (_display, win) =>
      this._watchWindow(win),
    );
    // Red de seguridad: si Mutter aun así marca el overlay como «pide atención», se activa para
    // limpiar la marca (ver _activateOverlay).
    this._attentionId = global.display.connect("window-demands-attention", (_display, win) =>
      this._activateOverlay(win),
    );
    for (const actor of global.get_window_actors()) this._watchWindow(actor.meta_window);

    // TODO (más adelante, dentro de esta misma épica): St.Clipboard.get_default()
    // en un polling o signal de cambio real, llamando this._service.notifyChange(entry).
  }

  // El título puede fijarse después de crear la ventana, y el marco no tiene
  // tamaño hasta el primer buffer: se revisa ahora, en cada cambio de título y
  // en cada cambio de tamaño hasta que la ventana principal quede colocada.
  _watchWindow(win) {
    if (this._titleHandlers.has(win)) return;
    const check = () => {
      if (isPinWindowTitle(win.get_title()) && !win.is_above()) win.make_above();
      this._placeMainWindow(win);
      this._activateOverlay(win);
    };
    const id = win.connect("notify::title", check);
    const sizeId = win.connect("size-changed", () => this._placeMainWindow(win));
    const unmanagedId = win.connect("unmanaged", () => {
      this._titleHandlers.delete(win);
    });
    this._titleHandlers.set(win, [id, sizeId, unmanagedId]);
    check();
  }

  // El overlay de captura nace desde el atajo, con la app en segundo plano: Wayland trata su
  // set_focus como «demanda de atención» y los docks (Dash to Dock, el dash del Shell) se muestran
  // para avisar, con el icono de Knivchit, justo cuando el usuario no quiere nada en pantalla. La
  // extensión, que es el compositor, lo activa nada más crearse (y otra vez si Mutter lo marca
  // igualmente) para que nazca con el foco. Solo el overlay de la propia app, por título y PID.
  _activateOverlay(win) {
    if (!this._active || !isCaptureOverlayTitle(win.get_title()) || !isOwnedByApp(win.get_pid(), this._appPid)) return;
    Main.activateWindow(win);
  }

  // Mutter termina su colocación inicial de la ventana en el mismo ciclo en que
  // avisa del primer tamaño; si se mueve a otro monitor dentro de ese aviso, la
  // devuelve donde la había puesto. Por eso el movimiento se difiere a un idle.
  _placeMainWindow(win) {
    if (this._placed.has(win) || !isMainWindowTitle(win.get_title()) || !isOwnedByApp(win.get_pid(), this._appPid)) return;
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;
    if (!placeMainWindow(Main.layoutManager.getWorkAreaForMonitor(monitor.index), win.get_frame_rect()))
      return; // sin tamaño todavía: reintenta en el próximo cambio
    this._placed.add(win);
    // disable() debe quitar todas las fuentes del bucle principal.
    const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._idleIds.delete(id);
      this._moveMainWindow(win);
      return GLib.SOURCE_REMOVE;
    });
    this._idleIds.add(id);
  }

  _moveMainWindow(win) {
    const monitor = Main.layoutManager.primaryMonitor;
    if (!monitor) return;
    const target = placeMainWindow(
      Main.layoutManager.getWorkAreaForMonitor(monitor.index),
      win.get_frame_rect(),
    );
    if (!target) return;
    this._applyPlacement(win, target);
    if (win.get_client_type() === Meta.WindowClientType.X11) this._holdPlacement(win, target);
  }

  _applyPlacement(win, target) {
    if (target.resize) win.move_resize_frame(false, target.x, target.y, target.width, target.height);
    else win.move_frame(false, target.x, target.y);
  }

  // Un cliente X11 (el AppImage fuerza GDK_BACKEND=x11) puede volver a colocarse
  // a sí mismo justo después del movimiento (GTK reafirma su posición inicial,
  // medido: a los 2 ms). Durante un instante se devuelve la ventana al sitio
  // elegido si se desvía y nadie la está arrastrando; pasado ese tiempo se
  // respeta cualquier movimiento del usuario. En Wayland no hace falta.
  _holdPlacement(win, target) {
    const handlerId = win.connect("position-changed", () => {
      const f = win.get_frame_rect();
      if (f.x !== target.x || f.y !== target.y) this._applyPlacement(win, target);
    });
    // Si el usuario empieza a arrastrarla, se deja de vigilar.
    const grabId = global.display.connect("grab-op-begin", (_display, grabbed) => {
      if (grabbed === win) this._releaseHold(win);
    });
    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOLD_PLACEMENT_MS, () => {
      this._releaseHold(win, true, false);
      return GLib.SOURCE_REMOVE;
    });
    this._holds.set(win, { handlerId, grabId, timerId });
    const unmanagedId = win.connect("unmanaged", () => this._releaseHold(win, false));
    this._holds.get(win).unmanagedId = unmanagedId;
  }

  // `disconnect`: false cuando la ventana ya no existe (unmanaged);
  // `removeTimer`: false cuando se llama desde el propio temporizador.
  _releaseHold(win, disconnect = true, removeTimer = true) {
    const hold = this._holds?.get(win);
    if (!hold) return;
    this._holds.delete(win);
    if (removeTimer) GLib.Source.remove(hold.timerId);
    global.display.disconnect(hold.grabId);
    if (disconnect) {
      win.disconnect(hold.handlerId);
      win.disconnect(hold.unmanagedId);
    }
  }

  // Captura teclado y ratón con un grab modal sobre un actor transparente a pantalla
  // completa, SIN modo de acción: así Mutter no ejecuta los atajos del sistema ni
  // el propio de Knivchit mientras se graba. Devuelve la función que lo libera
  // (o null si el Shell no concede el grab). Las pulsaciones solo se pasan al
  // grabador, que no las guarda ni las registra.
  _grabKeyboard() {
    // Solo con la ventana de Knivchit enfocada (desde ahí se pulsa «Grabar») y
    // nunca con la sesión bloqueada: así un proceso ajeno no puede tomar el
    // teclado en un momento arbitrario.
    if (Main.sessionMode.isLocked || !isMainWindowTitle(global.display.focus_window?.get_title() ?? "")) return null;
    const actor = new St.Widget({ reactive: true, can_focus: true, x: 0, y: 0, width: global.stage.width, height: global.stage.height });
    Main.uiGroup.add_child(actor);
    let grab = null;
    try {
      grab = Main.pushModal(actor, { actionMode: Shell.ActionMode.NONE });
    } catch {
      grab = null;
    }
    if (!grab) {
      actor.destroy();
      return null;
    }
    actor.grab_key_focus();
    const keyId = actor.connect("key-press-event", (_actor, event) => {
      this._recorder.key(this._describeKey(event));
      return Clutter.EVENT_STOP;
    });
    const buttonId = actor.connect("button-press-event", () => {
      this._recorder.pointer();
      return Clutter.EVENT_STOP;
    });
    return () => {
      try {
        actor.disconnect(keyId);
        actor.disconnect(buttonId);
      } finally {
        try {
          Main.popModal(grab);
        } finally {
          actor.destroy();
        }
      }
    };
  }

  // Super llega como MOD4_MASK (0x40) en el estado de Clutter, no como SUPER_MASK.
  _describeKey(event) {
    const symbol = event.get_key_symbol();
    const state = event.get_state();
    const M = Clutter.ModifierType;
    const mods = [];
    if (state & (M.SUPER_MASK | M.MOD4_MASK)) mods.push("Super");
    if (state & M.CONTROL_MASK) mods.push("Control");
    if (state & M.MOD1_MASK) mods.push("Alt");
    if (state & M.SHIFT_MASK) mods.push("Shift");
    return {
      keyName: Clutter.keyval_name(Clutter.keyval_convert_case(symbol)[0]) ?? "",
      mods,
      isModifier: isModifierKeysym(Clutter.keyval_name(symbol) ?? ""),
    };
  }

  // Botón del panel: solo un icono (symbolic, empaquetado en icons/, se recolorea con el
  // tema del panel) y un clic que pide a la app que muestre su ventana. Sin menú.
  _createPanelIcon() {
    const button = new PanelMenu.Button(0.0, this.metadata.name, true);
    button.add_child(
      new St.Icon({
        gicon: Gio.FileIcon.new(this.dir.get_child("icons").get_child("knivchit-symbolic.svg")),
        style_class: "system-status-icon",
      }),
    );
    button.accessible_name = "Knivchit";
    const open = () => {
      if (!Main.sessionMode.isLocked) this._callApp("ShowMain");
      return Clutter.EVENT_STOP;
    };
    button.connect("button-press-event", open);
    button.connect("touch-event", (_actor, event) =>
      event.type() === Clutter.EventType.TOUCH_BEGIN ? open() : Clutter.EVENT_PROPAGATE,
    );
    button.connect("key-press-event", (_actor, event) => {
      const key = event.get_key_symbol();
      return key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter || key === Clutter.KEY_space
        ? open()
        : Clutter.EVENT_PROPAGATE;
    });
    Main.panel.addToStatusArea(this.uuid, button, 0, "right");
    return button;
  }

  // Wayland trata el set_focus de una app en segundo plano como «demanda de atención»
  // («Knivchit está listo»): tras ShowMain la extensión, que es el compositor, activa la
  // ventana principal en cuanto aparece (hasta ~2 s; con la app recién arrancada tarda).
  _activateMainWindow(tries = 0) {
    if (!this._active) return;
    const win = global.get_window_actors().map((a) => a.meta_window).find((w) => isMainWindowTitle(w.get_title()) && isOwnedByApp(w.get_pid(), this._appPid));
    if (win) {
      Main.activateWindow(win);
      return;
    }
    if (tries >= 20) return;
    const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._retryIds.delete(id);
      this._activateMainWindow(tries + 1);
      return GLib.SOURCE_REMOVE;
    });
    this._retryIds.add(id);
  }

  _startCapture() {
    if (Main.sessionMode.isLocked) return;
    this._callApp("StartCapture");
  }

  // Un reintento a los 1.5s (cubre el arranque en frío de la activación por
  // D-Bus, ver install.sh) y, si también falla, un aviso discreto — antes el
  // callback vacío tragaba cualquier error en silencio y el usuario nunca se
  // enteraba de que el atajo no hizo nada. Decisión en `decideCallAppOutcome`
  // (lib/callAppRetry.js), pura y testeada; acá solo el cableado con Gio/Main.
  _callApp(method, attempt = 1) {
    Gio.DBus.session.call(
      "org.knivchit.App",
      "/org/knivchit/App",
      "org.knivchit.App",
      method,
      null,
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (conn, res) => {
        // La extensión pudo deshabilitarse mientras la llamada estaba en vuelo.
        if (!this._active) return;
        let failed = false;
        try {
          conn.call_finish(res);
        } catch {
          failed = true;
        }
        if (!failed && method === "ShowMain") this._activateMainWindow();
        const outcome = decideCallAppOutcome(attempt, failed);
        if (outcome.action === "retry") {
          // disable() debe quitar TODAS las fuentes del bucle principal, aunque
          // esta vaya a quitarse sola al devolver SOURCE_REMOVE.
          const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, outcome.delayMs, () => {
            this._retryIds.delete(id);
            this._callApp(method, attempt + 1);
            return GLib.SOURCE_REMOVE;
          });
          this._retryIds.add(id);
        } else if (outcome.action === "notify") {
          Main.notify("Knivchit", outcome.message);
        }
      },
    );
  }

  disable() {
    this._panelIcon?.stop();
    this._panelIcon = null;
    this._recorder?.dispose(); // libera el grab modal si había una grabación en curso
    this._recorder = null;
    this._active = false;
    for (const id of this._retryIds ?? []) GLib.Source.remove(id);
    this._retryIds = null;
    for (const id of this._idleIds ?? []) GLib.Source.remove(id);
    this._idleIds = null;
    Main.wm.removeKeybinding(CAPTURE_KEYBINDING_NAME);
    if (this._windowCreatedId) global.display.disconnect(this._windowCreatedId);
    this._windowCreatedId = null;
    if (this._attentionId) global.display.disconnect(this._attentionId);
    this._attentionId = null;
    for (const [win, ids] of this._titleHandlers ?? []) for (const id of ids) win.disconnect(id);
    this._titleHandlers = null;
    this._unwatchApp?.();
    this._unwatchApp = null;
    this._injections?.clear();
    this._injections = null;
    for (const win of [...this._holds.keys()]) this._releaseHold(win);
    this._holds = null;
    this._placed = null;
    if (this._serviceExported) this._service?.unexport();
    this._serviceExported = false;
    this._service = null;
    this._shortcuts = null;
    // Soltar el nombre: la app lo usa para saber si la extensión está activa y
    // sin esto el Shell lo seguiría teniendo después de deshabilitarla.
    Gio.DBus.session.call(
      "org.freedesktop.DBus",
      "/org/freedesktop/DBus",
      "org.freedesktop.DBus",
      "ReleaseName",
      new GLib.Variant("(s)", ["org.knivchit.ClipboardService"]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      () => {},
    );
    if (this._settingsChangedId) this._settings.disconnect(this._settingsChangedId);
    this._settingsChangedId = null;
    this._settings = null;
  }
}
