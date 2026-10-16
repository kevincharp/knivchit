#!/usr/bin/env bash
# Empaqueta extension/ (excluyendo tests/ y los scripts de empaquetado) en un .zip versionado.
# Uso: package.sh [--ego] [directorio-de-salida]
#   --ego  zip para extensions.gnome.org: sin schemas/gschemas.compiled (lo compila la
#          plataforma, igual que `gnome-extensions install`).
# La versión se lee de app/src-tauri/Cargo.toml — fuente única de verdad de
# la versión de release en todo el pipeline (ver env!("CARGO_PKG_VERSION")).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

VERSION=$(grep -m1 '^version' "$REPO_ROOT/app/src-tauri/Cargo.toml" | sed -E 's/version = "(.*)"/\1/')

EGO=0
if [ "${1:-}" = "--ego" ]; then
  EGO=1
  shift
fi
OUT_DIR="${1:-$SCRIPT_DIR}"
mkdir -p "$OUT_DIR"
ZIP_NAME="knivchit-extension-v${VERSION}.zip"
ZIP_PATH="$(cd "$OUT_DIR" && pwd)/$ZIP_NAME"

# Se empaqueta una copia con el esquema GSettings ya compilado: sin
# schemas/gschemas.compiled getSettings() falla y la extensión queda en ERROR si
# se instala descomprimiendo el zip a mano (`gnome-extensions install` y
# extensions.gnome.org lo compilan solos: con --ego no se incluye).
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r "$SCRIPT_DIR"/. "$STAGE"/
rm -f "$STAGE/schemas/gschemas.compiled"
if [ "$EGO" = 0 ]; then
  glib-compile-schemas --strict "$STAGE/schemas"
fi

rm -f "$ZIP_PATH"
cd "$STAGE"
zip -r -q "$ZIP_PATH" . -x 'tests/*' -x 'package.sh' -x 'package.test.sh'

echo "$ZIP_PATH"
