// Dónde colocar el panel flotante. Función pura, sin gi://Shell ni gi://Meta:
// extension.js pasa el área de trabajo, el cursor de texto y el puntero, y
// aplica el { x, y } que devuelve esto.
import { placeMainWindow } from "./windowPlacement.js";

const GAP = 8;

const contains = (area, x, y) =>
  x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;

// Un cursor de 0×0 o fuera del área es una lectura inútil del método de entrada.
const isUsableCaret = (caret, workArea) =>
  caret !== null && (caret.width > 0 || caret.height > 0) && contains(workArea, caret.x, caret.y);

/**
 * Con foco de texto el panel va a la derecha del cursor (o junto al puntero si
 * el cursor no sirve), alineado arriba; si no cabe sube o pasa a la izquierda.
 * Sin foco de texto queda donde la ventana principal. Nunca sale por arriba ni
 * por la izquierda del área, aunque el panel no quepa.
 *
 * workArea, size, caret: { x, y, width, height } enteros (size sin x, y);
 * pointer: { x, y }; caret puede ser null.
 */
export function placePicker({ workArea, size, caret, pointer, textFocus }) {
  let x;
  let y;
  if (!textFocus) {
    const main = placeMainWindow(workArea, size);
    x = main ? main.x : workArea.x;
    y = main ? main.y : workArea.y;
  } else {
    const anchor = isUsableCaret(caret, workArea)
      ? { left: caret.x, right: caret.x + caret.width, top: caret.y }
      : { left: pointer.x, right: pointer.x, top: pointer.y + GAP };
    x = anchor.right + GAP;
    y = anchor.top;
    if (x + size.width > workArea.x + workArea.width) x = anchor.left - GAP - size.width;
  }
  y = Math.min(y, workArea.y + workArea.height - size.height);
  x = Math.min(x, workArea.x + workArea.width - size.width);
  return {
    x: Math.max(x, workArea.x),
    y: Math.max(y, workArea.y),
  };
}
