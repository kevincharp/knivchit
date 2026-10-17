#!/usr/bin/env bash
# Quita las libwayland-* del AppImage ya construido y lo vuelve a empaquetar en su sitio.
# Uso: sin-libwayland.sh <carpeta-con-el-AppImage>
#
# Por qué: el AppImage se compila en ubuntu-22.04 y linuxdeploy copia dentro las
# libwayland-client/-cursor/-egl/-server de ese Ubuntu. Con un Mesa más nuevo en el
# sistema (Fedora 44, Mesa 26) el WebKitWebProcess empaquetado mezcla esas librerías
# viejas con el Mesa del sistema, aborta con «Could not create default EGL display:
# EGL_BAD_PARAMETER» y la ventana queda en blanco. Sin ellas, el AppImage usa las
# libwayland del sistema (GTK3 ya depende de ellas, así que siempre están).
# Probado: misma copia con y sin las libs → 2 volcados y ventana en blanco / 0 y se dibuja.
#
# Usa linuxdeploy-plugin-appimage, que `tauri build` ya descarga en ~/.cache/tauri.
set -euo pipefail

die() { printf 'sin-libwayland.sh: %s\n' "$*" >&2; exit 1; }

DIR="${1:?uso: sin-libwayland.sh <carpeta-con-el-AppImage>}"
PLUGIN="${APPIMAGE_PLUGIN:-$HOME/.cache/tauri/linuxdeploy-plugin-appimage.AppImage}"
[ -x "$PLUGIN" ] || die "no encuentro $PLUGIN (¿corrió antes 'tauri build --bundles appimage'?)"

DIR="$(cd "$DIR" && pwd)"
shopt -s nullglob
imgs=("$DIR"/*.AppImage)
[ "${#imgs[@]}" -eq 1 ] || die "debe haber exactamente un .AppImage en $DIR (hay ${#imgs[@]})"
IMG="${imgs[0]}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export APPIMAGE_EXTRACT_AND_RUN=1 # sin FUSE (el runner de CI no lo garantiza)

# 1. Extraer el AppImage original.
cp "$IMG" "$WORK/original.AppImage"
chmod +x "$WORK/original.AppImage"
(cd "$WORK" && ./original.AppImage --appimage-extract >/dev/null)
APPDIR="$WORK/squashfs-root"
[ -d "$APPDIR/usr/lib" ] || die "la extracción no produjo usr/lib"

# 2. Quitar las libwayland-* (y avisar de cuántas había: 0 sería señal de que el problema cambió).
libs=("$APPDIR"/usr/lib/libwayland-*)
[ "${#libs[@]}" -gt 0 ] || die "el AppImage no trae libwayland-*; el empaquetado cambió, revisar este script"
rm -f "${libs[@]}"
printf 'sin-libwayland.sh: quitadas %d libs: %s\n' "${#libs[@]}" "$(printf '%s ' "${libs[@]##*/}")"

# 3. Volver a empaquetar. El runtime (los bytes antes del squashfs) se reutiliza del AppImage
# original en vez de dejar que appimagetool baje otro de una release «continuous» sin hash.
offset="$("$WORK/original.AppImage" --appimage-offset)"
head -c "$offset" "$WORK/original.AppImage" > "$WORK/runtime"
mkdir "$WORK/salida"
(cd "$WORK/salida" && ARCH=x86_64 LDAI_RUNTIME_FILE="$WORK/runtime" "$PLUGIN" --appdir "$APPDIR" 2>&1 | tee "$WORK/plugin.log" >/dev/null)
! grep -q "Downloading runtime" "$WORK/plugin.log" || die "appimagetool bajó un runtime de la red; LDAI_RUNTIME_FILE no se respetó"
nuevas=("$WORK"/salida/*.AppImage)
[ "${#nuevas[@]}" -eq 1 ] || die "el empaquetado debía producir un .AppImage (produjo ${#nuevas[@]})"

# 4. Verificar el resultado antes de reemplazar nada: ya no puede haber libwayland-*.
mkdir "$WORK/verif"
chmod +x "${nuevas[0]}"
(cd "$WORK/verif" && "${nuevas[0]}" --appimage-extract >/dev/null)
resto=("$WORK"/verif/squashfs-root/usr/lib/libwayland-*)
[ "${#resto[@]}" -eq 0 ] || die "el AppImage nuevo todavía trae libwayland-*"

# 5. Reemplazar el original conservando su nombre.
mv "${nuevas[0]}" "$IMG"
chmod +x "$IMG"
printf 'sin-libwayland.sh: %s reempaquetado sin libwayland-*\n' "${IMG##*/}"
