# app/

Aplicación de escritorio (Tauri: Rust + frontend web). Sin la restricción
de la extensión — la captura de pantalla se pide vía el portal
`org.freedesktop.portal.Screenshot` / `org.gnome.Shell.Screenshot`, accesible
desde cualquier proceso normal.

## Responsabilidad

- Capturador de pantalla: selección con bordes redondeados, anotar.
- OCR sobre la captura (Tesseract o `zxing-cpp`, a decidir).
- Reconocimiento de QR.
- Traducción en vivo del texto detectado (API externa, a decidir).
- Picker del historial de portapapeles — lee lo que guarda `../extension/`
  vía D-Bus.

## Estado

Sin código todavía.
