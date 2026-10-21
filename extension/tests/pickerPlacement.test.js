import { placePicker } from "../lib/pickerPlacement.js";

// Corre con `gjs -m extension/tests/pickerPlacement.test.js` (no necesita bus).

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};

const rect = (x, y, width, height) => ({ x, y, width, height });
const SIZE = { width: 320, height: 400 };
const AREA = rect(0, 32, 1920, 1048);
const POINTER = { x: 700, y: 400 };

const check = (label, input, expected) => {
  const got = placePicker({ workArea: AREA, size: SIZE, caret: null, pointer: POINTER, textFocus: true, ...input });
  if (got.x !== expected.x || got.y !== expected.y)
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(expected)}`);
};

check("cursor válido: a la derecha y alineado arriba", { caret: rect(500, 300, 2, 18) }, { x: 510, y: 300 });
check("no cabe por abajo: sube hasta el borde inferior", { caret: rect(500, 900, 2, 18) }, { x: 510, y: 680 });
check("no cabe por la derecha: pasa a la izquierda del cursor", { caret: rect(1800, 300, 2, 18) }, { x: 1472, y: 300 });
check("cursor de 0×0 con foco de texto: junto al puntero", { caret: rect(500, 300, 0, 0) }, { x: 708, y: 408 });
check("cursor fuera del área: junto al puntero", { caret: rect(5000, 300, 2, 18) }, { x: 708, y: 408 });
check("sin cursor: junto al puntero", {}, { x: 708, y: 408 });
check("puntero en la esquina inferior derecha: se recoloca", { pointer: { x: 1900, y: 1000 } }, { x: 1572, y: 680 });
check("sin foco de texto: la posición de la ventana principal", { textFocus: false, caret: rect(500, 300, 2, 18) }, { x: 1568, y: 356 });
check("área menor que el panel: no sale por arriba ni por la izquierda", { workArea: rect(0, 32, 200, 300), caret: rect(100, 100, 2, 18) }, { x: 0, y: 32 });
check("área menor y sin foco de texto", { workArea: rect(0, 32, 200, 300), textFocus: false }, { x: 0, y: 32 });
check("área con origen desplazado", { workArea: rect(1920, 32, 1920, 1048), caret: rect(2000, 300, 2, 18) }, { x: 2010, y: 300 });

print("PASS: placePicker coloca el panel junto al cursor, al puntero o como la ventana principal");
