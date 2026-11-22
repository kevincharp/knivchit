import { END_REASONS } from "../lib/insertSession.js";
import { canInsert, describeWindow, fixTarget, trackFocus, verifyAfterInsert } from "../lib/insertTarget.js";

// Corre con `gjs -m extension/tests/insertTarget.test.js`. Las ventanas son objetos
// simulados con la misma forma que Meta.Window.

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

const APP_PID = 900;
const fakeWindow = ({ id, pid = 100, title = "Documento", parent = null }) => ({
  get_id: () => id,
  get_pid: () => pid,
  get_title: () => title,
  get_transient_for: () => parent,
});

const editor = describeWindow(fakeWindow({ id: 1, title: "Editor" }));
const picker = describeWindow(fakeWindow({ id: 2, pid: APP_PID, title: "knivchit-picker" }));

// describeWindow copia solo lo que se compara después.
check(
  JSON.stringify(editor) === JSON.stringify({ id: 1, pid: 100, title: "Editor", parentId: null }),
  `describeWindow, dio ${JSON.stringify(editor)}`,
);
const child = describeWindow(fakeWindow({ id: 7, title: "Guardar", parent: fakeWindow({ id: 1 }) }));
check(child.parentId === 1, "describeWindow recuerda la ventana madre del modal");
check(describeWindow(null) === null, "sin ventana, describeWindow da null");

// fixTarget: solo una ventana ajena a Knivchit es destino.
check(fixTarget(editor, APP_PID) === editor, "una ventana ajena se fija como destino");
check(fixTarget(picker, APP_PID) === null, "una ventana de Knivchit no es destino");
check(fixTarget(null, APP_PID) === null, "sin ventana enfocada no hay destino");

// trackFocus: el foco solo puede estar en el destino, en el panel o en ninguna parte.
{
  const other = describeWindow(fakeWindow({ id: 3, title: "Otra" }));
  check(trackFocus(editor, editor, picker.id).fatal === false, "foco en el destino: bien");
  check(trackFocus(editor, picker, picker.id).fatal === false, "foco en el panel: bien");
  check(trackFocus(editor, null, picker.id).fatal === false, "foco en ninguna ventana (transitorio): bien");
  check(trackFocus(editor, other, picker.id).fatal === true, "Alt+Tab a otra ventana mata la sesión");
  const popup = describeWindow(fakeWindow({ id: 4, title: "Aviso" }));
  check(trackFocus(editor, popup, picker.id).fatal === true, "una ventana que roba el foco mata la sesión");
  check(trackFocus(editor, child, picker.id).fatal === true, "un modal hijo del destino mata la sesión");
  check(trackFocus(editor, other, picker.id).reason === "target_changed", "el motivo es target_changed");
}


// fixTarget falla cerrado: sin ids ni pids enteros, o sin appPid, no hay destino.
check(fixTarget({ ...editor, pid: undefined }, APP_PID) === null, "sin pid no hay destino");
check(fixTarget({ ...editor, pid: 0 }, APP_PID) === null, "pid 0 no es destino");
check(fixTarget({ ...editor, id: undefined }, APP_PID) === null, "sin id no hay destino");
check(fixTarget(editor, null) === null, "sin appPid (la app no está en el bus) no hay destino");
check(fixTarget(editor, undefined) === null, "appPid indefinido: no hay destino");

// trackFocus: un foco sin id entero no se confunde con el panel.
check(trackFocus(editor, { id: undefined }, undefined).fatal === true, "foco sin id con pickerId indefinido es fatal");
check(trackFocus(editor, { id: null }, null).fatal === true, "foco con id null y pickerId null es fatal");
// El foco que la extensión devuelve al destino no cuenta como cambio.
check(trackFocus(editor, picker, picker.id).fatal === false && trackFocus(editor, editor, picker.id).fatal === false, "foco que va y vuelve entre panel y destino: bien");

// canInsert: tabla de casos. Estado sano de partida.
const healthy = () => ({
  target: editor,
  focus: { ...editor },
  modalCount: 0,
  overviewVisible: false,
  input: null,
});

const cases = [
  ["estado sano", (s) => s, { ok: true }],
  ["sin destino", (s) => ({ ...s, target: null }), { ok: false, reason: "no_target", fatal: false }],
  ["modal del Shell abierto", (s) => ({ ...s, modalCount: 1 }), { ok: false, reason: "shell_modal", fatal: false }],
  ["vista de actividades visible", (s) => ({ ...s, overviewVisible: true }), { ok: false, reason: "overview", fatal: false }],
  ["ninguna ventana con foco", (s) => ({ ...s, focus: null }), { ok: false, reason: "focus_lost", fatal: false }],
  [
    "el foco está en un modal hijo del destino",
    (s) => ({ ...s, focus: { id: 7, pid: 100, title: "Guardar", parentId: 1 } }),
    { ok: false, reason: "modal_child", fatal: true },
  ],
  [
    "el foco está en otra ventana",
    (s) => ({ ...s, focus: { id: 3, pid: 100, title: "Otra", parentId: null } }),
    { ok: false, reason: "target_changed", fatal: true },
  ],
  [
    "la misma ventana cambió de proceso",
    (s) => ({ ...s, focus: { ...editor, pid: 101 } }),
    { ok: false, reason: "pid_changed", fatal: true },
  ],
  [
    "la misma ventana cambió de título",
    (s) => ({ ...s, focus: { ...editor, title: "Otra pestaña" } }),
    { ok: false, reason: "title_changed", fatal: true },
  ],
  ["campo de contraseña", (s) => ({ ...s, input: { purpose: "password", sensitive: false } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["campo de PIN", (s) => ({ ...s, input: { purpose: "pin", sensitive: false } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["campo marcado como sensible", (s) => ({ ...s, input: { purpose: "free_form", sensitive: true } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["modalCount indefinido", (s) => ({ ...s, modalCount: undefined }), { ok: false, reason: "shell_modal", fatal: false }],
  ["modalCount negativo", (s) => ({ ...s, modalCount: -1 }), { ok: false, reason: "shell_modal", fatal: false }],
  ["modalCount NaN", (s) => ({ ...s, modalCount: Number.NaN }), { ok: false, reason: "shell_modal", fatal: false }],
  ["modalCount null", (s) => ({ ...s, modalCount: null }), { ok: false, reason: "shell_modal", fatal: false }],
  ["overviewVisible indefinido", (s) => ({ ...s, overviewVisible: undefined }), { ok: false, reason: "overview", fatal: false }],
  ["propósito en mayúsculas", (s) => ({ ...s, input: { purpose: "PASSWORD", sensitive: false } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["propósito numérico", (s) => ({ ...s, input: { purpose: 8, sensitive: false } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["propósito desconocido", (s) => ({ ...s, input: { purpose: "otro", sensitive: false } }), { ok: false, reason: "sensitive_field", fatal: false }],
  ["propósito terminal", (s) => ({ ...s, input: { purpose: "terminal", sensitive: false } }), { ok: true }],
  ["propósito número", (s) => ({ ...s, input: { purpose: "number", sensitive: false } }), { ok: true }],
  ["foco cambiado con un modal del Shell abierto", (s) => ({ ...s, modalCount: 1, focus: { id: 3, pid: 100, title: "Otra", parentId: null } }), { ok: false, reason: "target_changed", fatal: true }],
  ["foco cambiado con la vista de actividades", (s) => ({ ...s, overviewVisible: true, focus: { id: 3, pid: 100, title: "Otra", parentId: null } }), { ok: false, reason: "target_changed", fatal: true }],
  ["campo de texto normal", (s) => ({ ...s, input: { purpose: "free_form", sensitive: false } }), { ok: true }],
  ["tipo de campo desconocido", (s) => ({ ...s, input: null }), { ok: true }],
];

for (const [name, mutate, expected] of cases) {
  const got = canInsert(mutate(healthy()));
  check(JSON.stringify(got) === JSON.stringify(expected), `canInsert «${name}»: esperaba ${JSON.stringify(expected)}, dio ${JSON.stringify(got)}`);
}

// Prioridad: un cambio de destino pesa más que un campo de contraseña.
{
  const got = canInsert({ ...healthy(), focus: { id: 3, pid: 100, title: "Otra", parentId: null }, input: { purpose: "password", sensitive: true } });
  check(got.reason === "target_changed", `el cambio de destino manda sobre el campo sensible, dio ${got.reason}`);
}


// Tras insertar y devolver el foco, cualquier fallo mata la sesión (también los que de
// por sí solo rechazarían una inserción).
{
  check(JSON.stringify(verifyAfterInsert(healthy())) === JSON.stringify({ ok: true }), "tras insertar, el estado sano sigue siendo ok");
  const lost = verifyAfterInsert({ ...healthy(), focus: null });
  check(lost.ok === false && lost.reason === "focus_lost" && lost.fatal === true, `focus_lost tras insertar es fatal, dio ${JSON.stringify(lost)}`);
  const overview = verifyAfterInsert({ ...healthy(), overviewVisible: true });
  check(overview.fatal === true, "overview tras insertar es fatal");
  const secret = verifyAfterInsert({ ...healthy(), input: { purpose: "password", sensitive: false } });
  check(secret.fatal === true, "campo sensible tras insertar es fatal");
}

// El cierre y el cambio del destino existen como motivos de la sesión.
check(END_REASONS.includes("target_closed"), "END_REASONS incluye target_closed");
check(END_REASONS.includes("target_changed"), "END_REASONS incluye target_changed");

if (failures.length > 0) {
  for (const f of failures) printerr(`FAIL: ${f}`);
  imports.system.exit(1);
}

print("PASS: destino de la inserción (fijado, seguimiento del foco y comprobaciones previas)");
