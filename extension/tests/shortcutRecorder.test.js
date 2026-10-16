import { parseAccelerator } from "../lib/shortcuts.js";
import { ShortcutRecorder } from "../lib/shortcutRecorder.js";

// Corre con `gjs -m extension/tests/shortcutRecorder.test.js` (no necesita bus).
// La máquina de estados de la grabación es pura: el Shell le inyecta cómo
// capturar el teclado (grab), el reloj y la validación. Lo que más importa es
// que el grab se libere SIEMPRE, y que nunca se retengan las teclas pulsadas.

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};
const eq = (got, want, label) => {
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`);
};

const KNOWN = new Set(["a", "c", "l", "q", "v", "Tab", "Escape", "Print", "space", "exclam", "F9"]);
const parse = (raw) => parseAccelerator(raw, (name) => KNOWN.has(name));

// Reloj falso: los temporizadores solo avanzan cuando el test lo pide.
const makeClock = () => {
  let now = 0, nextId = 1;
  const timers = new Map();
  return {
    setTimer: (ms, cb) => { const id = nextId++; timers.set(id, { at: now + ms, cb }); return id; },
    clearTimer: (id) => timers.delete(id),
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.cb(); }
    },
    pending: () => timers.size,
  };
};

const make = ({ grabResult = "ok", timeoutMs = 12000, cooldownMs = 0 } = {}) => {
  const clock = makeClock();
  const log = { grabs: 0, releases: 0, results: [] };
  const recorder = new ShortcutRecorder({
    grab: () => {
      log.grabs++;
      if (grabResult === "fail") return null;
      return () => {
        log.releases++;
        if (grabResult === "release-throws") throw new Error("popModal falló");
      };
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    parse,
    timeoutMs,
    cooldownMs,
  });
  const begin = () => recorder.begin((accel, status) => log.results.push([accel, status]));
  return { recorder, clock, log, begin };
};
const key = (keyName, mods = [], isModifier = false) => ({ keyName, mods, isModifier });

// 1. Combinación normal ------------------------------------------------------------
{
  const { recorder, clock, log, begin } = make();
  begin();
  eq([log.grabs, recorder.recording, clock.pending()], [1, true, 1], "begin captura el teclado y arma el temporizador");
  // los modificadores sueltos se ignoran (no terminan ni se acumulan)
  recorder.key(key("Super_L", [], true));
  recorder.key(key("Shift_L", ["Super"], true));
  eq([log.results.length, log.releases, recorder.recording], [0, 0, true], "los modificadores solos no terminan");
  recorder.key(key("c", ["Super", "Shift"]));
  eq(log.results, [["<Super><Shift>c", "ok"]], "resultado");
  eq([log.releases, recorder.recording, clock.pending()], [1, false, 0], "libera el grab, deja de grabar y limpia el temporizador");
  // lo que llegue después se ignora: ni segundo resultado ni segundo release
  recorder.key(key("a", ["Control"]));
  recorder.pointer();
  clock.advance(60000);
  eq([log.results.length, log.releases], [1, 1], "tras terminar todo se ignora");
}

// El orden de los modificadores del resultado es fijo aunque el Shell los entregue en otro
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("c", ["Shift", "Alt", "Control", "Super"]));
  eq(log.results, [["<Super><Control><Alt><Shift>c", "ok"]], "orden fijo de modificadores");
}

// Shift+Tab produce el símbolo ISO_Left_Tab: se normaliza a Tab (con Shift) como hace GTK
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("ISO_Left_Tab", ["Super", "Shift"]));
  eq(log.results, [["<Super><Shift>Tab", "ok"]], "ISO_Left_Tab => Tab");
}
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("ISO_Left_Tab", ["Super"])); // aunque el Shell no marque Shift, ISO_Left_Tab implica Shift
  eq(log.results, [["<Super><Shift>Tab", "ok"]], "ISO_Left_Tab implica Shift");
}

// 2. Esc cancela; Esc con Super/Ctrl/Alt es una combinación válida ----------------------
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("Escape", []));
  eq(log.results, [["", "cancelled"]], "Esc cancela");
  eq(log.releases, 1, "Esc libera");
}
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("Escape", ["Shift"]));
  eq(log.results, [["", "cancelled"]], "Shift+Esc también cancela (Shift no cuenta)");
}
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("Escape", ["Super"]));
  eq(log.results, [["<Super>Escape", "ok"]], "Super+Esc es una combinación");
}

// 3. Combinación inválida: termina con el motivo -----------------------------------------
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("a", []));
  eq(log.results.length, 1, "una tecla sola termina");
  eq(log.results[0][1], "invalid", "estado invalid");
  if (!log.results[0][0].toLowerCase().includes("modificador")) fail(`el motivo debería mencionar el modificador: ${log.results[0][0]}`);
  eq(log.releases, 1, "invalid también libera");
}
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("noexiste", ["Super"]));
  eq(log.results[0][1], "invalid", "tecla inexistente");
}
{
  const { recorder, log, begin } = make();
  begin();
  recorder.key(key("exclam", ["Super", "Shift"])); // Shift+1: se devuelve el símbolo tal cual
  eq(log.results, [["<Super><Shift>exclam", "ok"]], "símbolo con Shift tal cual");
}

// 4. Clic de ratón cancela -----------------------------------------------------------------
{
  const { recorder, log, begin } = make();
  begin();
  recorder.pointer();
  eq(log.results, [["", "cancelled"]], "clic cancela");
  eq(log.releases, 1, "clic libera");
}

// 5. Tiempo máximo ------------------------------------------------------------------------------
{
  const { recorder, clock, log, begin } = make({ timeoutMs: 12000 });
  begin();
  clock.advance(11999);
  eq([log.results.length, recorder.recording], [0, true], "antes del límite sigue grabando");
  clock.advance(1);
  eq(log.results, [["", "timeout"]], "al llegar al límite vence");
  eq([log.releases, recorder.recording], [1, false], "timeout libera");
}

// 6. Cliente desaparecido o extensión deshabilitada: abort() libera --------------------------
{
  const { recorder, clock, log, begin } = make();
  begin();
  recorder.abort();
  eq(log.results, [["", "cancelled"]], "abort cancela");
  eq([log.releases, recorder.recording, clock.pending()], [1, false, 0], "abort libera y limpia el temporizador");
  recorder.abort(); // idempotente
  eq(log.releases, 1, "abort repetido no libera dos veces");
}
{
  const { recorder, log } = make();
  recorder.abort(); // sin grabación en curso: no hace nada
  eq([log.releases, log.results.length], [0, 0], "abort sin grabación");
}

// 7. Una segunda llamada es «busy» y no toca la grabación en curso ------------------------------
{
  const { recorder, log, begin } = make();
  begin();
  const second = [];
  recorder.begin((accel, status) => second.push([accel, status]));
  eq(second, [["", "busy"]], "la segunda llamada recibe busy");
  eq([log.grabs, log.releases, recorder.recording], [1, 0, true], "la primera sigue intacta (un solo grab, sin liberar)");
  recorder.key(key("c", ["Control","Alt"]));
  eq(log.results, [["<Control><Alt>c", "ok"]], "la primera termina con normalidad");
  eq(second.length, 1, "la segunda no recibe nada más");
}

// 8. No se pudo capturar el teclado ----------------------------------------------------------------
{
  const { recorder, clock, log, begin } = make({ grabResult: "fail" });
  begin();
  eq(log.results, [["", "unavailable"]], "sin grab => unavailable");
  eq([recorder.recording, clock.pending(), log.releases], [false, 0, 0], "no queda nada armado");
  // y se puede volver a intentar
  const again = [];
  recorder.begin((a, s) => again.push([a, s]));
  eq(again, [["", "unavailable"]], "reintento");
}

// 9. Fallos al liberar o al responder no impiden lo otro ------------------------------------------------
{
  const { recorder, log, begin } = make({ grabResult: "release-throws" });
  begin();
  recorder.key(key("c", ["Control","Alt"]));
  eq(log.results, [["<Control><Alt>c", "ok"]], "aunque release lance, el resultado se entrega");
  eq(recorder.recording, false, "y la grabación acaba");
}
{
  const clock = makeClock();
  let released = 0;
  const recorder = new ShortcutRecorder({ grab: () => () => { released++; }, setTimer: clock.setTimer, clearTimer: clock.clearTimer, parse, timeoutMs: 1000, cooldownMs: 0 });
  recorder.begin(() => { throw new Error("el cliente ya no está"); });
  let threw = false;
  try { recorder.key(key("c", ["Control","Alt"])); } catch { threw = true; }
  eq([released, recorder.recording], [1, false], "aunque la respuesta lance, el grab se libera");
  if (!threw) fail("la excepción de la respuesta debería propagarse (no se silencia) tras liberar");
}

// 10. Privacidad: no se retienen las teclas pulsadas ---------------------------------------------------------
{
  const { recorder, begin } = make();
  begin();
  recorder.key(key("Super_L", [], true));
  recorder.key(key("Q", ["Control", "Alt"])); // una letra distinta
  const retained = JSON.stringify(Object.entries(recorder)); // las funciones no se serializan: solo datos
  if (/Super_L|"Q"|"q"|Control|Alt/.test(retained)) fail(`el grabador retiene datos de teclas: ${retained}`);
}

// 11. Enfriamiento: no se puede re-tomar el grab en bucle -----------------------------------------------------
{
  const { recorder, clock, log, begin } = make({ cooldownMs: 750 });
  begin();
  recorder.key(key("Escape"));
  begin(); // justo después: rechazada, sin tomar el grab
  eq(log.grabs, 1, "durante el enfriamiento no se toma otro grab");
  eq(log.results.at(-1), ["", "busy"], "durante el enfriamiento responde busy");
  clock.advance(749);
  begin();
  eq(log.grabs, 1, "a los 749 ms sigue enfriándose");
  clock.advance(1);
  begin();
  eq(log.grabs, 2, "pasado el enfriamiento se puede grabar de nuevo");
  recorder.abort();
  recorder.dispose();
  eq(clock.pending(), 0, "dispose() no deja temporizadores");
}

print("PASS: ShortcutRecorder libera siempre el grab (resultado, Esc, clic, tiempo, abort), responde busy/unavailable y no retiene teclas");
