// Máquina de estados de la grabación de un atajo (RecordShortcut). Pura: sin
// gi://Shell, gi://Meta ni Main. El Shell le inyecta cómo capturar el teclado
// (`grab`, que devuelve la función que lo libera o null), el reloj y la
// validación; así se prueba, con reloj falso, que el grab se libera SIEMPRE.
//
// Un grab modal deja al escritorio sin teclado ni ratón mientras dura, por eso
// termina por cualquiera de estas vías y todas pasan por `_finish`:
// combinación válida o inválida, Esc, clic, tiempo máximo y abort() (cliente
// D-Bus desaparecido o extensión deshabilitada).
//
// Privacidad: el grab ve el teclado entero mientras dura, pero aquí solo se usa
// la combinación final. Las teclas pulsadas NO se guardan, ni se registran, ni
// se envían a ningún sitio; el único dato que sale es el acelerador ya
// normalizado, y solo hacia quien llamó a begin().

export const DEFAULT_TIMEOUT_MS = 12000;
// Tras terminar una grabación no se admite otra durante este tiempo (responde
// «busy»): un cliente no puede re-tomar el grab modal en bucle y dejar el
// escritorio sin teclado ni ratón (EXT-01).
export const DEFAULT_COOLDOWN_MS = 750;

// Orden fijo en el que se escriben los modificadores del acelerador.
const MODIFIER_ORDER = ["Super", "Control", "Alt", "Shift"];

export class ShortcutRecorder {
  constructor({ grab, setTimer, clearTimer, parse, timeoutMs = DEFAULT_TIMEOUT_MS, cooldownMs = DEFAULT_COOLDOWN_MS }) {
    this._cooldownMs = cooldownMs;
    this._cooling = false;
    this._grab = grab;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._parse = parse;
    this._timeoutMs = timeoutMs;
    this._release = null;
    this._onResult = null;
    this._timer = 0;
  }

  get recording() {
    return this._release !== null;
  }

  /**
   * Empieza a grabar y llama UNA vez a `onResult(accel, status)`. status:
   * ok | cancelled | timeout | invalid (accel lleva el motivo) | busy (ya había
   * una grabación; la que estaba en curso no se toca) | unavailable (no se pudo
   * capturar el teclado).
   */
  begin(onResult) {
    if (this.recording || this._cooling) {
      onResult("", "busy");
      return;
    }
    const release = this._grab();
    if (!release) {
      onResult("", "unavailable");
      return;
    }
    this._release = release;
    this._onResult = onResult;
    this._timer = this._setTimer(this._timeoutMs, () => {
      this._timer = 0;
      this._finish("", "timeout");
    });
  }

  /** Una pulsación: { keyName, mods: ["Super"|"Control"|"Alt"|"Shift"], isModifier }. */
  key({ keyName, mods, isModifier }) {
    if (!this.recording || isModifier) return; // un modificador solo no termina nada
    if (keyName === "Escape" && !mods.some((m) => m !== "Shift")) {
      this._finish("", "cancelled");
      return;
    }
    // Shift+Tab produce el símbolo ISO_Left_Tab; el atajo se escribe <Shift>Tab (como hace GTK).
    const isLeftTab = keyName === "ISO_Left_Tab";
    const effectiveMods = isLeftTab ? [...mods, "Shift"] : mods;
    const prefix = MODIFIER_ORDER.filter((m) => effectiveMods.includes(m))
      .map((m) => `<${m}>`)
      .join("");
    const parsed = this._parse(prefix + (isLeftTab ? "Tab" : keyName));
    if (parsed.ok) this._finish(parsed.accel, "ok");
    else this._finish(parsed.error, "invalid");
  }

  /** Un clic de ratón en cualquier sitio cancela (el grab también se queda con el ratón). */
  pointer() {
    this._finish("", "cancelled");
  }

  /** Cliente D-Bus desaparecido o extensión deshabilitada. Idempotente. */
  abort() {
    this._finish("", "cancelled");
  }

  /** disable(): aborta y quita también el temporizador de enfriamiento. */
  dispose() {
    this.abort();
    if (this._coolTimer) this._clearTimer(this._coolTimer);
    this._coolTimer = 0;
    this._cooling = false;
  }

  _finish(accel, status) {
    if (!this.recording) return;
    const release = this._release;
    const onResult = this._onResult;
    this._release = null;
    this._onResult = null;
    if (this._timer) {
      this._clearTimer(this._timer);
      this._timer = 0;
    }
    if (this._cooldownMs > 0) {
      this._cooling = true;
      this._coolTimer = this._setTimer(this._cooldownMs, () => {
        this._coolTimer = 0;
        this._cooling = false;
      });
    }
    // Primero se libera, pase lo que pase: que falle la respuesta o el propio
    // release no puede dejar el teclado capturado.
    try {
      release();
    } catch (e) {
      console.error(`Knivchit: no se pudo liberar el grab del teclado: ${e.message ?? e}`);
    }
    onResult(accel, status);
  }
}
