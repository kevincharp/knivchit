// Dónde colocar la ventana principal de Knivchit. Función pura, sin
// gi://Shell ni gi://Meta: bajo Wayland una app no puede posicionar su propia
// ventana (set_position se ignora), así que lo hace la extensión, que ya es
// el compositor. extension.js solo le pasa el área de trabajo del monitor
// primario y el marco de la ventana, y aplica lo que esta función devuelve.
export const RIGHT_MARGIN = 32;
// Aire vertical total (la mitad arriba y la mitad abajo) que se deja al
// recortar una ventana que no cabe en el alto del área.
export const TOTAL_VERTICAL_MARGIN = 32;

/**
 * Deja la ventana a RIGHT_MARGIN px del borde DERECHO del área de trabajo y
 * CENTRADA en vertical dentro de ella (la barra superior de GNOME ya está
 * descontada del área). Si no cabe se recorta a lo disponible
 * (alto: área - TOTAL_VERTICAL_MARGIN; ancho: área - RIGHT_MARGIN) y se indica
 * con `resize: true`, para que el llamador use move_resize_frame en vez de
 * move_frame. Las coordenadas son enteras (el sobrante impar baja).
 *
 * workArea y frame: { x, y, width, height } y { width, height } enteros.
 * Devuelve { x, y, width, height, resize }, o null si algún tamaño no es
 * positivo o el área no deja sitio para los márgenes.
 */
export function placeMainWindow(workArea, frame) {
  const availableWidth = workArea.width - RIGHT_MARGIN;
  const availableHeight = workArea.height - TOTAL_VERTICAL_MARGIN;
  if (frame.width <= 0 || frame.height <= 0 || availableWidth <= 0 || availableHeight <= 0)
    return null;

  const width = Math.min(frame.width, availableWidth);
  const height = Math.min(frame.height, availableHeight);
  return {
    x: workArea.x + workArea.width - width - RIGHT_MARGIN,
    y: workArea.y + Math.floor((workArea.height - height) / 2),
    width,
    height,
    resize: width !== frame.width || height !== frame.height,
  };
}
