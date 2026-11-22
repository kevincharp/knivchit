// Destino de una inserción: la ventana que tenía el foco al abrir la sesión. Se fija una
// vez y no se sustituye: si el foco va a otra parte, la sesión termina. Funciones puras
// sobre «descripciones» de ventana (sin gi://Shell ni gi://Meta).
import { isOwnedByApp } from "./windowMatch.js";

// Copia solo lo que se compara después, para que un cambio posterior de la ventana
// real no altere lo que se fijó.
export function describeWindow(win) {
  if (!win) return null;
  return {
    id: win.get_id(),
    pid: win.get_pid(),
    title: win.get_title(),
    parentId: win.get_transient_for()?.get_id() ?? null,
  };
}

// Una ventana de Knivchit (el panel o la principal) nunca es destino: ahí solo se copia.
// Sin ids, pid ni appPid enteros no se puede comparar después, así que tampoco hay destino.
export function fixTarget(focus, appPid) {
  if (!focus || !Number.isInteger(appPid) || !Number.isInteger(focus.id)) return null;
  if (!Number.isInteger(focus.pid) || focus.pid <= 0 || isOwnedByApp(focus.pid, appPid)) return null;
  return focus;
}

// El foco solo puede estar en el destino, en el panel o en ninguna ventana (un
// instante entre dos). Cualquier otra ventana, incluido un modal hijo, es fatal.
export function trackFocus(target, focus, pickerId) {
  if (!focus) return { fatal: false };
  if (!Number.isInteger(focus.id)) return { fatal: true, reason: "target_changed" };
  if (focus.id === target.id || focus.id === pickerId) return { fatal: false };
  return { fatal: true, reason: "target_changed" };
}

// Propósitos de campo de texto que se pueden rellenar. Cualquier otro valor informado
// (contraseña, PIN o algo que no se reconoce) bloquea; null es «el sistema no informa».
const SAFE_PURPOSES = ["free_form", "alpha", "digits", "number", "phone", "url", "email", "name", "terminal"];

const reject = (reason, fatal) => ({ ok: false, reason, fatal });

// Comprobación justo antes de insertar, con el foco ya en el destino. `fatal` dice si
// además hay que cerrar la sesión (el destino ya no es el que se fijó) o solo rechazar
// esta inserción. Lo fatal se mira primero para que un modal o la vista de actividades
// no lo enmascaren. Los valores que faltan o no valen bloquean.
export function canInsert({ target, focus, modalCount, overviewVisible, input }) {
  if (!target) return reject("no_target", false);
  if (focus) {
    if (focus.parentId === target.id) return reject("modal_child", true);
    if (focus.id !== target.id) return reject("target_changed", true);
    if (focus.pid !== target.pid) return reject("pid_changed", true);
    if (focus.title !== target.title) return reject("title_changed", true);
  }
  if (modalCount !== 0) return reject("shell_modal", false);
  if (overviewVisible !== false) return reject("overview", false);
  if (!focus) return reject("focus_lost", false);
  if (input && (input.sensitive || !SAFE_PURPOSES.includes(input.purpose))) {
    return reject("sensitive_field", false);
  }
  return { ok: true };
}

// Tras insertar y devolver el foco al destino, un fallo no se reintenta: cierra la sesión.
export function verifyAfterInsert(state) {
  const verdict = canInsert(state);
  return verdict.ok ? verdict : { ...verdict, fatal: true };
}
