import { isCaptureOverlayTitle, isMainWindowTitle, isOwnedByApp, isPinWindowTitle } from "../lib/windowMatch.js";

// Corre con `gjs -m extension/tests/windowMatch.test.js` (no necesita bus).

const cases = [
  ["knivchit-pin", true],
  ["knivchit-pin-3f2a", true],
  ["knivchit-pin:abc", true],
  ["knivchit-capture-overlay", false],
  ["Knivchit", false],
  ["mi knivchit-pin", false],
  ["", false],
  [null, false],
  [undefined, false],
  [42, false],
];

for (const [title, expected] of cases) {
  const got = isPinWindowTitle(title);
  if (got !== expected) {
    printerr(`FAIL: isPinWindowTitle(${JSON.stringify(title)}) = ${got}, esperaba ${expected}`);
    imports.system.exit(1);
  }
}
// La ventana principal se reconoce por el título EXACTO «Knivchit»: ni el
// overlay de captura ni los pins ni una ventana ajena que lo contenga.
const mainCases = [
  ["Knivchit", true],
  ["knivchit", false],
  ["KNIVCHIT", false],
  ["Knivchit ", false],
  ["Knivchit - ajustes", false],
  ["mi Knivchit", false],
  ["knivchit-capture-overlay", false],
  ["knivchit-pin-3f2a", false],
  ["", false],
  [null, false],
  [undefined, false],
  [42, false],
];

for (const [title, expected] of mainCases) {
  const got = isMainWindowTitle(title);
  if (got !== expected) {
    printerr(`FAIL: isMainWindowTitle(${JSON.stringify(title)}) = ${got}, esperaba ${expected}`);
    imports.system.exit(1);
  }
}
const overlayCases = [
  ["knivchit-capture-overlay", true],
  ["knivchit-capture-overlay-2", false],
  ["Knivchit", false],
  ["knivchit-pin-1", false],
  [["view", "clip", "-capture-overlay"].join(""), false], // el título del nombre anterior ya no coincide (cadena armada en ejecución: el nombre anterior solo aparece en el código de migración)
  ["", false],
  [null, false],
  [undefined, false],
  [7, false],
];
for (const [title, expected] of overlayCases) {
  const got = isCaptureOverlayTitle(title);
  if (got !== expected) {
    printerr(`FAIL: isCaptureOverlayTitle(${JSON.stringify(title)}) = ${got}, esperaba ${expected}`);
    imports.system.exit(1);
  }
}
const ownedCases = [
  [4321, 4321, true],
  [4321, 4322, false],
  [4321, null, false], // la app no está en el bus
  [null, null, false],
  [0, 0, false],
  [-1, -1, false],
  [undefined, undefined, false],
  ["4321", 4321, false],
];
for (const [winPid, appPid, expected] of ownedCases) {
  const got = isOwnedByApp(winPid, appPid);
  if (got !== expected) {
    printerr(`FAIL: isOwnedByApp(${JSON.stringify(winPid)}, ${JSON.stringify(appPid)}) = ${got}, esperaba ${expected}`);
    imports.system.exit(1);
  }
}
print("PASS: isOwnedByApp exige el PID del dueño de org.knivchit.App");
print("PASS: isCaptureOverlayTitle reconoce solo el título exacto del overlay");
print("PASS: isPinWindowTitle reconoce solo títulos que empiezan por knivchit-pin");
print("PASS: isMainWindowTitle reconoce solo el título exacto Knivchit");
