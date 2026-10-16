// Icono opcional de Knivchit en la barra superior: la decisión de mostrarlo u
// ocultarlo, sin gi://Shell, gi://Meta ni Main (extensions.gnome.org y los tests
// con `gjs` a secas lo exigen). El Shell se inyecta: `createIcon()` crea el botón
// del panel y devuelve un manejador; `destroyIcon(manejador)` lo destruye.
// extension.js hace el cableado con PanelMenu/St.
//
// El icono es visible SOLO si el ajuste está activado Y la app está en marcha (estilo bandeja):
// al salir la app —Salir, cierre del proceso o caída— se destruye, y al arrancar vuelve solo.
// Garantías: nunca hay dos iconos (sync es idempotente, también al reactivar la
// extensión), el icono desaparece en stop() y el cambio de la clave de GSettings
// se aplica en vivo, venga de D-Bus (SetPanelIcon) o de dconf.

export const PANEL_ICON_KEY = "show-panel-icon";

export class PanelIconController {
  constructor({ settings, createIcon, destroyIcon, appRunning = false }) {
    this._appRunning = appRunning === true;
    this._settings = settings;
    this._createIcon = createIcon;
    this._destroyIcon = destroyIcon;
    this._icon = null;
    this._changedId = 0;
  }

  /** ¿Hay un icono en el panel ahora mismo? */
  get visible() {
    return this._icon !== null;
  }

  /** ¿Está la app en marcha (org.knivchit.App tiene dueño)? */
  get appRunning() {
    return this._appRunning;
  }

  /** La extensión avisa cuando la app aparece o desaparece del bus. */
  setAppRunning(running) {
    const value = running === true;
    if (value === this._appRunning) return;
    this._appRunning = value;
    this.sync();
  }

  /** Valor del ajuste (true por defecto en el esquema). El hub refleja ESTE valor, no la visibilidad. */
  isEnabled() {
    return this._settings.get_boolean(PANEL_ICON_KEY);
  }

  /** Empieza a vigilar el ajuste y aplica el valor actual. */
  start() {
    if (!this._changedId) this._changedId = this._settings.connect(`changed::${PANEL_ICON_KEY}`, () => this.sync());
    this.sync();
  }

  /** Deja el panel como corresponde: un icono si el ajuste está activado y la app corre, ninguno si no. */
  sync() {
    const want = this.isEnabled() && this._appRunning;
    if (want && this._icon === null) this._icon = this._createIcon();
    else if (!want && this._icon !== null) this._remove();
  }

  /**
   * SetPanelIcon: -> [ok, error]. Un valor que no sea booleano se rechaza como error
   * de validación (no como error D-Bus).
   */
  setEnabled(enabled) {
    if (typeof enabled !== "boolean") return [false, "El valor debe ser verdadero o falso."];
    this._settings.set_boolean(PANEL_ICON_KEY, enabled);
    this.sync(); // no depende de que el aviso de cambio llegue antes de responder
    return [true, ""];
  }

  /** disable(): quita el icono y deja de vigilar. */
  stop() {
    if (this._changedId) this._settings.disconnect(this._changedId);
    this._changedId = 0;
    this._remove();
  }

  _remove() {
    const icon = this._icon;
    this._icon = null;
    this._destroyIcon(icon);
  }
}
