import { RIGHT_MARGIN, TOTAL_VERTICAL_MARGIN, placeMainWindow } from "../lib/windowPlacement.js";

// Corre con `gjs -m extension/tests/windowPlacement.test.js` (no necesita bus).
// Áreas de trabajo en coordenadas globales del escritorio, como las devuelve
// Main.layoutManager.getWorkAreaForMonitor (ya descontada la barra superior).

const fail = (msg) => {
  printerr(`FAIL: ${msg}`);
  imports.system.exit(1);
};

const area = (x, y, width, height) => ({ x, y, width, height });
const frame = (width, height) => ({ width, height });
const place = (workArea, win, expected, label) => {
  const got = placeMainWindow(workArea, win);
  if (JSON.stringify(got) !== JSON.stringify(expected))
    fail(`${label}: obtuve ${JSON.stringify(got)}, esperaba ${JSON.stringify(expected)}`);
};

if (RIGHT_MARGIN !== 32) fail(`RIGHT_MARGIN debería ser 32 y es ${RIGHT_MARGIN}`);
if (TOTAL_VERTICAL_MARGIN !== 32) fail(`TOTAL_VERTICAL_MARGIN debería ser 32 y es ${TOTAL_VERTICAL_MARGIN}`);

// Monitor grande, barra superior de 32 px: 32 px de aire a la derecha y
// centrada en vertical en el área que deja la barra: 32 + (1048 - 720) / 2.
place(area(0, 32, 1920, 1048), frame(380, 720), { x: 1508, y: 196, width: 380, height: 720, resize: false }, "monitor grande");

// Monitor pequeño (1280x720): el área útil mide 688, la ventana de 720 no
// cabe → se recorta a 688 - 32 = 656, se centra (16 px arriba y abajo) y se
// marca para move_resize_frame.
place(area(0, 32, 1280, 688), frame(380, 720), { x: 868, y: 48, width: 380, height: 656, resize: true }, "monitor pequeño");

// Sin barra superior (y = 0): el centrado se mide en el área, no en la pantalla.
place(area(0, 0, 1366, 768), frame(380, 720), { x: 954, y: 24, width: 380, height: 720, resize: false }, "sin barra superior");

// El monitor primario no está en el origen (hay uno secundario a la izquierda):
// todo se mide desde el borde derecho de ESE monitor, no del escritorio.
place(area(1920, 32, 1920, 1048), frame(380, 720), { x: 3428, y: 196, width: 380, height: 720, resize: false }, "secundario a la izquierda");

// El área puede tener origen negativo en el escritorio global.
place(area(-1280, -100, 1280, 900), frame(380, 720), { x: -412, y: -10, width: 380, height: 720, resize: false }, "origen negativo");

// Cabe justo: alto = área - 32 → centrada con 16 px y sin redimensionar.
place(area(0, 32, 1280, 688), frame(380, 656), { x: 868, y: 48, width: 380, height: 656, resize: false }, "cabe justo");

// Las coordenadas son enteras: el sobrante impar se redondea hacia abajo.
place(area(0, 32, 1280, 689), frame(380, 600), { x: 868, y: 76, width: 380, height: 600, resize: false }, "centrado con sobrante impar");
place(area(0, 32, 1280, 689), frame(380, 720), { x: 868, y: 48, width: 380, height: 657, resize: true }, "recorte con área de altura impar");

// Ventana mayor que el área en los dos ejes: se recorta alto y ancho; el aire
// de la derecha se conserva (queda pegada al borde izquierdo del área).
place(area(0, 32, 800, 568), frame(1000, 2000), { x: 0, y: 48, width: 768, height: 536, resize: true }, "ventana mayor que el área");

// Solo el ancho sobra.
place(area(0, 32, 300, 900), frame(380, 720), { x: 0, y: 122, width: 268, height: 720, resize: true }, "solo sobra el ancho");

// Entradas inválidas: sin tamaño no hay nada que colocar.
for (const [label, a, f] of [
  ["marco sin tamaño", area(0, 32, 1280, 688), frame(0, 0)],
  ["marco negativo", area(0, 32, 1280, 688), frame(-1, 720)],
  ["área sin tamaño", area(0, 32, 0, 0), frame(380, 720)],
  ["área menor que los márgenes", area(0, 32, 32, 32), frame(380, 720)],
]) {
  const got = placeMainWindow(a, f);
  if (got !== null) fail(`${label}: esperaba null y obtuve ${JSON.stringify(got)}`);
}

print("PASS: placeMainWindow deja 32 px a la derecha, centra en vertical y recorta si no cabe");
