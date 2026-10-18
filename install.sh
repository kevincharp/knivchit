#!/usr/bin/env bash
# Instala/actualiza Knivchit desde el último release de GitHub: el AppImage, su
# entrada en el menú de aplicaciones (.desktop + iconos), la activación por
# D-Bus (para que el atajo global lo arranque solo) y la extensión de GNOME
# Shell con el atajo. Correr de nuevo actualiza.
#
# Todo lo que se descarga se verifica contra SHA256SUMS ANTES de tocar nada:
# si algo no cuadra, no se instala ni se pisa nada.
#
# Sin opciones instala el release MÁS RECIENTE, pre-releases incluidos (mientras no haya
# estables) y lo anuncia: «instalando PRE-RELEASE vX». `--stable` exige un release estable;
# `--version <tag>` (p. ej. v0.1.0-alpha.1) fija una versión concreta.
#
# `install.sh --from-dir <carpeta>` instala desde una carpeta local con el AppImage,
# (opcionalmente) el zip de la extensión y SHA256SUMS, para probar un candidato sin red.
# OJO: ahí las sumas están en la propia carpeta, así que solo detectan corrupción o
# archivos truncados, NO manipulación: quien pueda cambiar el AppImage puede cambiar también
# SHA256SUMS. La carpeta tiene que ser de confianza (la has generado tú o la has comprobado).
#
# `install.sh --uninstall` revierte todo (binario, menú, iconos, servicio D-Bus,
# autoarranque, extensión y logs). No borra tus capturas ni la base de datos de
# la app (~/.local/share/org.knivchit.app).
#
# Con Knivchit abierto no se pisa nada: en una terminal pregunta si cerrarlo y, sin ella, se
# niega. `--close-app` lo cierra sin preguntar. Solo toca los procesos de ESTA instalación.
set -euo pipefail

KNIVCHIT_API_BASE="${KNIVCHIT_API_BASE:-https://api.github.com/repos/kevincharp/knivchit}"
KNIVCHIT_BIN_DIR="${KNIVCHIT_BIN_DIR:-$HOME/.local/bin}"
KNIVCHIT_DESKTOP_DIR="${KNIVCHIT_DESKTOP_DIR:-$HOME/.local/share/applications}"
KNIVCHIT_DATA_DIR="${KNIVCHIT_DATA_DIR:-$HOME/.local/share/knivchit}"
KNIVCHIT_DBUS_SERVICE_DIR="${KNIVCHIT_DBUS_SERVICE_DIR:-$HOME/.local/share/dbus-1/services}"
KNIVCHIT_ICON_DIR="${KNIVCHIT_ICON_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/icons}"
KNIVCHIT_AUTOSTART_DIR="${KNIVCHIT_AUTOSTART_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/autostart}"

# PROVISIONAL: el dominio del uuid aún no está decidido. Si cambia, hay que cambiarlo a la vez
# en extension/metadata.json, en EXT_UUID de este script, en la carpeta de instalación, en las
# pruebas (install.test.sh, extension/tests) y en lo que mencione el uuid; los usuarios con la
# extensión instalada tendrían que reinstalarla y volver a elegir sus atajos.
EXT_UUID="knivchit@knivchit.dev"
EXT_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"

# Restos del nombre anterior (ViewClip). Se migran y se borran al instalar; las
# referencias al nombre viejo son a propósito.
LEGACY_EXT_UUID="viewclip@viewclip.dev"
LEGACY_SCHEMA="org.gnome.shell.extensions.viewclip"
# Constante, NO derivada de KNIVCHIT_DATA_DIR (una variable mal puesta borraría otra carpeta).
LEGACY_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/viewclip"
BIN_PATH="$KNIVCHIT_BIN_DIR/knivchit"
DESKTOP_PATH="$KNIVCHIT_DESKTOP_DIR/knivchit.desktop"
DBUS_SERVICE_PATH="$KNIVCHIT_DBUS_SERVICE_DIR/org.knivchit.App.service"
AUTOSTART_PATH="$KNIVCHIT_AUTOSTART_DIR/knivchit.desktop"

have() { command -v "$1" >/dev/null 2>&1; }
warn() { printf 'install.sh: aviso: %s\n' "$*" >&2; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

# Borrado de carpetas de datos con guardas. La ruta viene de una variable de
# entorno configurable, así que antes de borrar nada se exige: ruta absoluta sin
# «..», con el nombre base esperado (knivchit / viewclip), que no sea / ni $HOME ni
# un antecesor de $HOME, que sea una carpeta real (no un enlace) y que solo se
# quiten los archivos de log propios; si queda algo más, se deja y se avisa.
safe_dir() { # ruta nombre-base
	local p="${1:-}" base="$2"
	[ -n "$p" ] || return 1
	case "$p" in /*) ;; *) return 1 ;; esac
	case "$p" in */../* | */.. | */./* | */.) return 1 ;; esac
	while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
	[ "${p##*/}" = "$base" ] || return 1
	case "${HOME:-/}/" in "$p"/*) return 1 ;; esac
	[ -d "$p" ] && [ ! -L "$p" ]
}

remove_logs_dir() { # ruta nombre-base
	if [ ! -e "${1:-}" ] && [ ! -L "${1:-}" ]; then return 0; fi
	if ! safe_dir "${1:-}" "$2"; then
		warn "no borro '${1:-}': no parece una carpeta de datos de $2 (ruta absoluta, sin '..', de nombre '$2' y fuera de tu carpeta personal)."
		return 0
	fi
	find "$1" -maxdepth 1 -type f \( -name "$2*.log" -o -name "$2*.log.*" \) -delete
	rmdir "$1" 2>/dev/null || warn "'$1' contiene otros archivos además de los logs de $2; los dejo."
}

LOCAL_DIR=""
WANT_VERSION=""
WANT_STABLE=0
CLOSE_APP=0
RELEASE_IS_PRE=0
WORK=""
trap '[ -n "$WORK" ] && rm -rf "$WORK"' EXIT

# Procesos de ESTA instalación y nada más: llamados «knivchit», del usuario actual, y cuyo ejecutable
# es el binario instalado (el ayudante del AppImage, «helper») o que heredaron APPIMAGE=<binario> (la
# app). Así nunca se toca otro Knivchit, p. ej. una copia de desarrollo en otra ruta. Imprime «tipo pid».
knivchit_procs() { # [app|helper]
	local d real kind
	real=$(readlink -f "$BIN_PATH" 2>/dev/null || printf '%s' "$BIN_PATH")
	for d in /proc/[0-9]*; do
		[ -O "$d" ] || continue
		[ "$(cat "$d/comm" 2>/dev/null)" = knivchit ] || continue
		kind=""
		if [ "$(readlink "$d/exe" 2>/dev/null)" = "$real" ]; then
			kind=helper
		elif tr '\0' '\n' <"$d/environ" 2>/dev/null | grep -xF -e "APPIMAGE=$BIN_PATH" -e "APPIMAGE=$real" >/dev/null; then
			kind=app
		fi
		if [ -n "$kind" ] && { [ -z "${1:-}" ] || [ "$1" = "$kind" ]; }; then echo "$kind ${d#/proc/}"; fi
	done
	return 0
}

signal_procs() { # tipo señal
	local pid
	for pid in $(knivchit_procs "$1" | awk '{print $2}'); do kill "-$2" "$pid" 2>/dev/null || true; done
}

wait_gone() { # tipo segundos
	local i
	for i in $(seq 1 $(($2 * 10))); do
		[ -z "$(knivchit_procs "$1")" ] && return 0
		sleep 0.1
	done
	return 1
}

# Si Knivchit está abierto: pregunta (en una terminal) o exige --close-app, y lo cierra con SIGTERM,
# primero la app y luego su ayudante del AppImage, que sale solo al desmontar. No usa SIGKILL.
ensure_app_closed() {
	[ -n "$(knivchit_procs)" ] || return 0
	if [ "$CLOSE_APP" != 1 ]; then
		if [ -t 0 ]; then
			printf 'Knivchit está abierto y hay que cerrarlo para continuar. ¿Cerrarlo ahora? [s/N] ' >&2
			local answer=""
			read -r answer || true
			case "$answer" in s | S | sí | si | SI | y | Y) ;; *) die "no se cambió nada: cierra Knivchit y vuelve a ejecutar el instalador." ;; esac
		else
			die "Knivchit está abierto: ciérralo y vuelve a ejecutar el instalador, o ejecútalo con --close-app para que lo cierre él. No se cambió nada."
		fi
	fi
	echo "Cerrando Knivchit ..."
	signal_procs app TERM
	wait_gone app 5 || true
	wait_gone helper 5 || { signal_procs helper TERM; wait_gone helper 5 || true; }
	[ -z "$(knivchit_procs)" ] || die "no pude cerrar Knivchit (procesos: $(knivchit_procs | awk '{printf "%s ", $2}')). Ciérralo a mano y vuelve a ejecutar el instalador."
}

uninstall() {
	ensure_app_closed
	rm -f "$BIN_PATH" "$DESKTOP_PATH" "$DBUS_SERVICE_PATH" "$AUTOSTART_PATH"
	if [ -d "$KNIVCHIT_ICON_DIR/hicolor" ]; then
		find "$KNIVCHIT_ICON_DIR/hicolor" -path '*/apps/knivchit.*' -type f -delete
	fi
	if have gnome-extensions; then
		gnome-extensions uninstall "$EXT_UUID" >/dev/null 2>&1 || true
	fi
	remove_logs_dir "$KNIVCHIT_DATA_DIR" knivchit
	remove_legacy_install
	echo "knivchit desinstalado."
	echo "Tus capturas y la base de datos de la app (~/.local/share/org.knivchit.app) no se han borrado."
	echo "Para que GNOME olvide el permiso de captura de pantalla de Knivchit: flatpak permission-reset knivchit"
}

# ¿Contiene la ruta algo que un Exec= o un servicio D-Bus interpretaría?
has_exec_unsafe() {
	case "$1" in *$'\n'* | *$'\r'*) return 0 ;; esac
	printf '%s' "$1" | LC_ALL=C grep -q '[]\[[:cntrl:]"'"'"'\\$`%;&|<>(){}*?~#!]'
}

# --- Comprobaciones previas ----------------------------------------------------
check_tools() {
	local t tools="curl python3 sha256sum"
	[ -z "${LOCAL_DIR:-}" ] || tools="python3 sha256sum" # el modo local no toca la red
	for t in $tools; do
		have "$t" || die "falta '$t', que el instalador necesita. Instálalo con el gestor de paquetes de tu distribución y vuelve a ejecutar."
	done
	case "$KNIVCHIT_BIN_DIR$KNIVCHIT_DBUS_SERVICE_DIR$KNIVCHIT_DESKTOP_DIR" in
	*[[:space:]]*) die "las rutas de instalación no pueden contener espacios (romperían Exec= del .desktop y del servicio D-Bus)." ;;
	esac
	# La ruta del binario va dentro de Exec= (.desktop, servicio D-Bus y autoarranque): sin
	# comillas, barras invertidas, $, acentos graves, % ni caracteres de control, que esos
	# formatos interpretan, y absoluta (un Exec= relativo no encuentra el binario).
	case "$KNIVCHIT_BIN_DIR" in
	/*) ;;
	*) die "KNIVCHIT_BIN_DIR debe ser una ruta absoluta (está en el Exec= del .desktop y del servicio D-Bus)." ;;
	esac
	if has_exec_unsafe "$KNIVCHIT_BIN_DIR"; then
		die "KNIVCHIT_BIN_DIR contiene caracteres que los archivos .desktop y de servicio D-Bus interpretan (comillas, \\, \$, \`, %, ;, &, saltos de línea, etc.); elige otra ruta."
	fi
}

# --- Release: metadatos y descarga verificada ------------------------------------
# Opciones de curl para hablar con GitHub: solo HTTPS (también en redirecciones) y TLS >= 1.2.
# Con una API que no es https (solo pruebas locales: KNIVCHIT_API_BASE) no se imponen.
CURL_SEC=()
case "$KNIVCHIT_API_BASE" in
https://*) CURL_SEC=(--proto '=https' --proto-redir '=https' --tlsv1.2) ;;
esac

# Pide una URL de la API y deja el cuerpo en $2; devuelve el código HTTP por stdout.
api_get() { # url archivo
	curl -sSL ${CURL_SEC[@]+"${CURL_SEC[@]}"} --retry 2 --connect-timeout 15 -o "$2" -w '%{http_code}' "$1" ||
		die "no se pudo conectar con $1. Revisa tu conexión a Internet y vuelve a intentarlo."
}

# Elige el release y lista sus assets. Entrada: modo (list = respuesta de /releases, un array;
# one = un solo release) y el JSON. Salida (TSV): «tag», «pre» (1/0) y un «asset» por archivo.
# De un array descarta los borradores y toma el MÁS RECIENTE por fecha, pre-release incluido.
# Solo acepta assets con nombre simple (nunca una ruta) y, si la API es https, con URL https.
parse_release() { # modo archivo https(0/1)
	python3 - "$1" "$2" "$3" <<'PY' 2>/dev/null
import json, re, sys
mode, path, https = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
d = json.load(open(path))
if mode == "list":
    if not isinstance(d, list):
        sys.exit(1)
    cands = [r for r in d if isinstance(r, dict) and not r.get("draft")]
    if not cands:
        print("empty")
        sys.exit(0)
    cands.sort(key=lambda r: str(r.get("published_at") or r.get("created_at") or ""), reverse=True)
    d = cands[0]
elif not isinstance(d, dict) or d.get("draft"):
    sys.exit(1)
print("tag\t%s\t" % d["tag_name"])
print("pre\t%s\t" % ("1" if d.get("prerelease") else "0"))
for a in d["assets"]:
    name, url = a["name"], a["browser_download_url"]
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name) or (https and not url.startswith("https://")):
        continue
    print("asset\t%s\t%s" % (name, url))
PY
}

# Rellena RELEASE_TAG, RELEASE_IS_PRE, APPIMAGE_NAME/URL, ZIP_NAME/URL y SUMS_URL.
#   por defecto: el release más reciente de /releases, pre-releases incluidos (mientras no haya
#                estables); --stable: /releases/latest (GitHub excluye los pre-releases);
#                --version <tag>: /releases/tags/<tag>.
fetch_release() {
	local url mode=list https=0 json code listing
	case "$KNIVCHIT_API_BASE" in
	https://*) https=1 ;;
	*)
		# Una variable de entorno heredada no puede degradar el instalador a http en silencio.
		[ "${KNIVCHIT_ALLOW_INSECURE_API:-}" = 1 ] ||
			die "KNIVCHIT_API_BASE ('$KNIVCHIT_API_BASE') no es https: el instalador no impone TLS ni verifica el origen con una API así. Solo para pruebas locales: KNIVCHIT_ALLOW_INSECURE_API=1."
		warn "KNIVCHIT_API_BASE no es https y KNIVCHIT_ALLOW_INSECURE_API=1: sin TLS. Solo para pruebas locales." ;;
	esac
	if [ -n "$WANT_VERSION" ]; then
		url="$KNIVCHIT_API_BASE/releases/tags/$WANT_VERSION"; mode=one
	elif [ "$WANT_STABLE" = 1 ]; then
		url="$KNIVCHIT_API_BASE/releases/latest"; mode=one
	else
		url="$KNIVCHIT_API_BASE/releases?per_page=10"
	fi
	json="$WORK/release.json"
	code=$(api_get "$url" "$json")
	case "$code" in
	404)
		if [ -n "$WANT_VERSION" ]; then
			die "no existe el release '$WANT_VERSION' en $KNIVCHIT_API_BASE."
		elif [ "$WANT_STABLE" = 1 ]; then
			die "no hay ningún release ESTABLE publicado todavía (solo pre-releases, si hay alguno). Quita --stable para instalar el más reciente o usa --version <tag>."
		fi
		die "No hay ningún release publicado en $KNIVCHIT_API_BASE todavía. Cuando exista, vuelve a ejecutar este instalador." ;;
	000 | 200) ;;
	*) die "GitHub respondió HTTP $code al consultar $url; vuelve a intentarlo más tarde." ;;
	esac
	listing=$(parse_release "$mode" "$json" "$https") || die "la respuesta del release no tiene el formato esperado; no se instala nada."
	[ "$listing" != empty ] || die "No hay ningún release publicado en $KNIVCHIT_API_BASE todavía (la lista está vacía o solo tiene borradores). Cuando exista, vuelve a ejecutar este instalador."

	RELEASE_TAG=$(awk -F'\t' '$1 == "tag" {print $2}' <<<"$listing")
	RELEASE_IS_PRE=$(awk -F'\t' '$1 == "pre" {print $2}' <<<"$listing")
	if [ "$WANT_STABLE" = 1 ] && [ "$RELEASE_IS_PRE" = 1 ]; then
		die "el release '$RELEASE_TAG' es un pre-release y se pidió --stable; no se instala nada."
	fi
	APPIMAGE_NAME=$(awk -F'\t' '$1 == "asset" && $2 ~ /\.AppImage$/ {print $2; exit}' <<<"$listing")
	APPIMAGE_URL=$(awk -F'\t' '$1 == "asset" && $2 ~ /\.AppImage$/ {print $3; exit}' <<<"$listing")
	ZIP_NAME=$(awk -F'\t' '$1 == "asset" && $2 ~ /^knivchit-extension-.*\.zip$/ {print $2; exit}' <<<"$listing")
	ZIP_URL=$(awk -F'\t' '$1 == "asset" && $2 ~ /^knivchit-extension-.*\.zip$/ {print $3; exit}' <<<"$listing")
	SUMS_URL=$(awk -F'\t' '$1 == "asset" && $2 == "SHA256SUMS" {print $3; exit}' <<<"$listing")

	[ -n "$APPIMAGE_URL" ] || die "el release $RELEASE_TAG no incluye un .AppImage; no se instala nada."
	[ -n "$SUMS_URL" ] || die "el release $RELEASE_TAG no incluye SHA256SUMS: no se puede verificar la descarga, así que no se instala nada."
}

download() { # url destino
	curl -fsSL ${CURL_SEC[@]+"${CURL_SEC[@]}"} --retry 2 --connect-timeout 15 -o "$2" "$1" || die "no se pudo descargar $1"
}

verify() { # archivo nombre-en-SHA256SUMS
	local want got
	want=$(awk -v n="$2" '{f = $2; sub(/^\*/, "", f); if (f == n) {print tolower($1); exit}}' "$WORK/SHA256SUMS")
	[ -n "$want" ] || die "SHA256SUMS no incluye '$2'; no se instala nada."
	got=$(sha256sum "$1" | awk '{print tolower($1)}')
	[ "$want" = "$got" ] ||
		die "la suma sha256 de '$2' no coincide (esperada $want, obtenida $got). La descarga está corrupta o alterada; no se instala nada."
}

# --- Piezas de la instalación -----------------------------------------------------
install_binary() {
	mkdir -p "$KNIVCHIT_BIN_DIR"
	install -m 755 "$WORK/$APPIMAGE_NAME" "$BIN_PATH.new"
	mv -f "$BIN_PATH.new" "$BIN_PATH" # atómico: también vale con la app en ejecución
}

png_size() { # lado en píxeles de un PNG (stdout) o error si no lo es
	python3 - "$1" <<'PY'
import struct, sys
with open(sys.argv[1], "rb") as f:
    head = f.read(24)
if head[:8] != b"\x89PNG\r\n\x1a\n":
    sys.exit(1)
print(struct.unpack(">II", head[16:24])[0])
PY
}

# Los iconos salen del propio AppImage (así siguen a los que genere `tauri icon`).
# Se instalan según su tamaño REAL: Tauri llama «256x256@2» a uno de 256 px.
install_icons() {
	local dir="$WORK/icons" f size
	mkdir -p "$dir"
	if ! (cd "$dir" && "$WORK/$APPIMAGE_NAME" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1); then
		warn "no pude extraer los iconos del AppImage; la entrada del menú saldrá con el icono genérico."
		return 0
	fi
	if [ -d "$KNIVCHIT_ICON_DIR/hicolor" ]; then
		find "$KNIVCHIT_ICON_DIR/hicolor" -path '*/apps/knivchit.*' -type f -delete
	fi
	while IFS= read -r f; do
		case "$f" in
		*.svg)
			mkdir -p "$KNIVCHIT_ICON_DIR/hicolor/scalable/apps"
			install -m 644 "$f" "$KNIVCHIT_ICON_DIR/hicolor/scalable/apps/knivchit.svg"
			;;
		*)
			size=$(png_size "$f") || continue
			mkdir -p "$KNIVCHIT_ICON_DIR/hicolor/${size}x${size}/apps"
			install -m 644 "$f" "$KNIVCHIT_ICON_DIR/hicolor/${size}x${size}/apps/knivchit.png"
			;;
		esac
	done < <(find "$dir/squashfs-root/usr/share/icons" -type f \( -name 'knivchit.png' -o -name 'knivchit.svg' \))
	if have gtk-update-icon-cache; then
		gtk-update-icon-cache -q -t -f "$KNIVCHIT_ICON_DIR/hicolor" >/dev/null 2>&1 || true
	fi
}

# Un único identificador de aplicación, «knivchit», para que el permiso de captura que concede
# el usuario (xdg-desktop-portal lo guarda por app id) valga lo mismo arrancada desde el menú que
# por activación D-Bus. GNOME deduce el app id del NOMBRE de este archivo (knivchit.desktop ->
# «knivchit») y reconoce su ventana por StartupWMClass=knivchit. Si algún día cambia el nombre del
# archivo, cambian a la vez StartupWMClass, el DBus Name del servicio y la app. Para que GNOME
# olvide el permiso concedido: `flatpak permission-reset knivchit`.
install_desktop_entry() {
	mkdir -p "$KNIVCHIT_DESKTOP_DIR"
	cat >"$DESKTOP_PATH" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Knivchit
GenericName=Capturador de pantalla
GenericName[en]=Screenshot tool
Comment=Capturador de pantalla con anotaciones
Comment[en]=Screen capture with annotations
Exec=$BIN_PATH
Icon=knivchit
Terminal=false
Categories=Utility;GTK;GNOME;
StartupNotify=true
StartupWMClass=knivchit
Keywords=captura;pantalla;screenshot;recorte;anotar;
Keywords[en]=screenshot;screen;capture;crop;annotate;
EOF
	if have desktop-file-validate && ! desktop-file-validate "$DESKTOP_PATH" >/dev/null 2>&1; then
		warn "desktop-file-validate no da por bueno $DESKTOP_PATH; revísalo si la entrada no aparece en el menú."
	fi
	if have update-desktop-database; then
		update-desktop-database -q "$KNIVCHIT_DESKTOP_DIR" >/dev/null 2>&1 || true
	fi
}

# Activación por D-Bus: si el atajo global llama a org.knivchit.App sin que el
# proceso esté corriendo, dbus-daemon lee este archivo y lo lanza solo (--hidden:
# sin mostrar la ventana principal al arrancar así).
install_dbus_service() {
	mkdir -p "$KNIVCHIT_DBUS_SERVICE_DIR"
	cat >"$DBUS_SERVICE_PATH" <<EOF
[D-BUS Service]
Name=org.knivchit.App
Exec=$BIN_PATH --hidden
EOF
}

# `gnome-extensions enable` falla con una extensión recién instalada que el
# Shell aún no ha escaneado («no existe»): se deja en enabled-extensions para
# el próximo inicio de sesión.
enable_for_next_login() {
	have gsettings || return 1
	local cur new
	cur=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null) || return 1
	new=$(python3 - "$cur" "$EXT_UUID" <<'PY'
import ast, sys
raw = sys.argv[1].strip()
if raw.startswith("@as"):
    raw = raw[3:].strip()
items = ast.literal_eval(raw)
if sys.argv[2] not in items:
    items.append(sys.argv[2])
print(repr(items))
PY
	) || return 1
	gsettings set org.gnome.shell enabled-extensions "$new"
}

install_extension() {
	EXT_NOTE=""
	if [ -z "$ZIP_URL" ]; then
		warn "este release no incluye la extensión de GNOME; el atajo global no funcionará hasta instalarla."
		return 0
	fi
	if ! have gnome-extensions; then
		warn "no encuentro el comando 'gnome-extensions' (¿no usas GNOME?). La extensión del atajo global no se ha instalado."
		return 0
	fi
	if ! gnome-extensions install --force "$WORK/$ZIP_NAME" >/dev/null 2>&1; then
		warn "'gnome-extensions install' falló; la extensión del atajo global no se ha instalado."
		return 0
	fi
	if gnome-extensions enable "$EXT_UUID" >/dev/null 2>&1; then
		EXT_NOTE="activada"
	elif enable_for_next_login; then
		EXT_NOTE="pendiente de reinicio de sesión"
	else
		warn "no pude habilitar la extensión; hazlo con: gnome-extensions enable $EXT_UUID"
	fi
}

# --- Migración desde el nombre anterior (ViewClip) -----------------------------------
# Atajos: la extensión vieja guardaba los atajos en su propio esquema GSettings.
# Se leen UNA vez (con su carpeta de esquemas, aunque el Shell no la tenga cargada)
# y se vuelcan al esquema nuevo solo si allí siguen vacíos.
migrate_legacy_shortcuts() {
	local old_dir="$EXT_ROOT/$LEGACY_EXT_UUID/schemas" new_dir="$EXT_ROOT/$EXT_UUID/schemas" suffix old cur accel clean
	have gsettings || return 0
	[ -f "$old_dir/gschemas.compiled" ] && [ -f "$new_dir/gschemas.compiled" ] || return 0
	for suffix in start-capture open-emoji open-clipboard; do
		old=$(gsettings --schemadir "$old_dir" get "$LEGACY_SCHEMA" "viewclip-$suffix" 2>/dev/null) || continue
		case "$old" in "" | "[]" | "@as []") continue ;; esac
		cur=$(gsettings --schemadir "$new_dir" get org.gnome.shell.extensions.knivchit "knivchit-$suffix" 2>/dev/null) || continue
		case "$cur" in "[]" | "@as []") ;; *) continue ;; esac
		# El valor viejo NO es de fiar (la extensión anterior aceptaba <Control>c, etc.):
		# solo se copia si pasa las mismas reglas que SetShortcut.
		accel=$(first_accelerator "$old") || { warn "el atajo '$suffix' de la extensión anterior no tiene un formato legible; no lo migro."; continue; }
		clean=$(validated_accelerator "$accel") || { warn "el atajo '$suffix' de la extensión anterior ('$accel') no es válido o está reservado; no lo migro."; continue; }
		# Lo que se interpola en el valor GVariant no puede llevar comillas ni nada raro: solo
		# modificadores entre <> y una tecla de letras, cifras y «_».
		printf '%s' "$clean" | grep -Eq '^(<[A-Za-z0-9_]+>)*[A-Za-z0-9_]+$' ||
			{ warn "el atajo '$suffix' de la extensión anterior tiene caracteres no permitidos; no lo migro."; continue; }
		gsettings --schemadir "$new_dir" set org.gnome.shell.extensions.knivchit "knivchit-$suffix" "['$clean']" ||
			warn "no pude copiar el atajo '$suffix' de la extensión anterior."
	done
}

# Primer elemento de un valor `as` de gsettings («['<Super>x']», «@as ['…']»).
first_accelerator() { # valor
	python3 - "$1" <<'PY'
import ast, sys
raw = sys.argv[1].strip()
if raw.startswith("@as"):
    raw = raw[3:].strip()
items = ast.literal_eval(raw)
if not (isinstance(items, list) and items and isinstance(items[0], str)):
    sys.exit(1)
print(items[0])
PY
}

# Pasa un acelerador por parseAccelerator() de la extensión instalada (las mismas
# reglas que SetShortcut: modificador obligatorio, aceleradores reservados…). Sin
# gjs o sin la extensión no hay forma de validar, y entonces no se migra nada.
validated_accelerator() { # acelerador
	local lib="$EXT_ROOT/$EXT_UUID/lib/shortcuts.js" script out
	have gjs && [ -f "$lib" ] || return 1
	script=$(mktemp "${TMPDIR:-/tmp}/knivchit-accel.XXXXXX.js") || return 1
	cat >"$script" <<'JS'
import GLib from "gi://GLib";
const { parseAccelerator } = await import(`file://${GLib.getenv("LIB")}`);
// Solo importan las reglas de uso, no si la tecla existe en el teclado de este equipo.
const r = parseAccelerator(GLib.getenv("ACCEL"), () => true);
if (!r.ok) imports.system.exit(1);
print(r.accel);
JS
	out=$(LIB="$lib" ACCEL="$1" gjs -m "$script" 2>/dev/null) || { rm -f "$script"; return 1; }
	rm -f "$script"
	[ -n "$out" ] || return 1
	printf '%s\n' "$out"
}

# Quita de `enabled-extensions` el uuid viejo (sin tocar nada más).
forget_legacy_extension() {
	have gsettings || return 0
	local cur new
	cur=$(gsettings get org.gnome.shell enabled-extensions 2>/dev/null) || return 0
	new=$(python3 - "$cur" "$LEGACY_EXT_UUID" <<'PY'
import ast, sys
raw = sys.argv[1].strip()
if raw.startswith("@as"):
    raw = raw[3:].strip()
items = ast.literal_eval(raw)
if sys.argv[2] in items:
    print(repr([i for i in items if i != sys.argv[2]]))
PY
	) || return 0
	[ -z "$new" ] || gsettings set org.gnome.shell enabled-extensions "$new"
}

# Borra lo instalado con el nombre anterior: binario, menú, servicio D-Bus,
# iconos, logs y la extensión vieja. NO toca ~/.local/share/org.viewclip.app (la app
# lo copia al arrancar y queda como respaldo).
remove_legacy_install() {
	if [ -d "$EXT_ROOT/$LEGACY_EXT_UUID" ]; then
		if have gnome-extensions; then
			gnome-extensions disable "$LEGACY_EXT_UUID" >/dev/null 2>&1 || true
			gnome-extensions uninstall "$LEGACY_EXT_UUID" >/dev/null 2>&1 || true
		fi
		rm -rf "${EXT_ROOT:?}/$LEGACY_EXT_UUID"
		forget_legacy_extension
	fi
	rm -f "$KNIVCHIT_BIN_DIR/viewclip" "$KNIVCHIT_DESKTOP_DIR/viewclip.desktop" \
		"$KNIVCHIT_DBUS_SERVICE_DIR/org.viewclip.App.service" "$KNIVCHIT_AUTOSTART_DIR/viewclip.desktop"
	if [ -d "$KNIVCHIT_ICON_DIR/hicolor" ]; then
		find "$KNIVCHIT_ICON_DIR/hicolor" -path '*/apps/viewclip.*' -type f -delete
	fi
	remove_logs_dir "$LEGACY_DATA_DIR" viewclip
}

# Si el autoarranque estaba activo con el nombre viejo, se conserva con el nuevo
# (debe correr ANTES de remove_legacy_install, que borra el archivo viejo).
migrate_legacy_autostart() {
	[ -f "$KNIVCHIT_AUTOSTART_DIR/viewclip.desktop" ] || return 0
	cat >"$AUTOSTART_PATH" <<EOF
[Desktop Entry]
Type=Application
Name=Knivchit
Comment=Capturador de pantalla e historial de portapapeles
Exec="$BIN_PATH" --hidden
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
}

# Modo local (--from-dir): copia al directorio de trabajo lo que hay en la carpeta (así se instala
# exactamente lo que se verifica) y rellena las mismas variables que fetch_release. Sin red.
fetch_local() { # carpeta
	local dir="$1" f n
	[ -d "$dir" ] || die "'$dir' no es una carpeta."
	local appimages=() zips=()
	for f in "$dir"/*.AppImage; do [ -f "$f" ] && appimages+=("$f"); done
	for f in "$dir"/knivchit-extension-*.zip; do [ -f "$f" ] && zips+=("$f"); done
	[ -f "$dir/SHA256SUMS" ] || die "'$dir' no contiene SHA256SUMS: no se puede verificar, así que no se instala nada."
	[ "${#appimages[@]}" -ge 1 ] || die "'$dir' no contiene ningún .AppImage; no se instala nada."
	[ "${#appimages[@]}" -le 1 ] || die "'$dir' contiene más de un .AppImage; deja solo el candidato a instalar."
	[ "${#zips[@]}" -le 1 ] || die "'$dir' contiene más de un zip de la extensión; deja solo uno."
	APPIMAGE_NAME="${appimages[0]##*/}"
	ZIP_NAME=""
	[ "${#zips[@]}" -eq 0 ] || ZIP_NAME="${zips[0]##*/}"
	for n in "$APPIMAGE_NAME" "$ZIP_NAME"; do
		[ -z "$n" ] || printf '%s' "$n" | grep -Eq '^[A-Za-z0-9._-]+$' || die "el nombre de archivo '$n' tiene caracteres no permitidos; no se instala nada."
	done
	RELEASE_TAG="(local: $dir)"
	cp -- "$dir/SHA256SUMS" "$WORK/SHA256SUMS"
	cp -- "$dir/$APPIMAGE_NAME" "$WORK/$APPIMAGE_NAME"
	[ -z "$ZIP_NAME" ] || cp -- "$dir/$ZIP_NAME" "$WORK/$ZIP_NAME"
	ZIP_URL="$ZIP_NAME" # solo importa que no esté vacío: install_extension lo usa como «hay zip»
}

do_install() {
	check_tools
	WORK=$(mktemp -d)
	if [ -n "${LOCAL_DIR:-}" ]; then
		fetch_local "$LOCAL_DIR"
		echo "Instalando Knivchit desde ${LOCAL_DIR} (sin red) ..."
	else
		fetch_release
		if [ "$RELEASE_IS_PRE" = 1 ]; then
			echo "instalando PRE-RELEASE $RELEASE_TAG (versión de pruebas, no estable)"
		else
			echo "instalando el release $RELEASE_TAG"
		fi
		echo "Descargando Knivchit $RELEASE_TAG ..."
		download "$SUMS_URL" "$WORK/SHA256SUMS"
		download "$APPIMAGE_URL" "$WORK/$APPIMAGE_NAME"
	fi
	verify "$WORK/$APPIMAGE_NAME" "$APPIMAGE_NAME"
	if [ -n "$ZIP_URL" ]; then
		[ -n "${LOCAL_DIR:-}" ] || download "$ZIP_URL" "$WORK/$ZIP_NAME"
		verify "$WORK/$ZIP_NAME" "$ZIP_NAME"
	fi
	chmod +x "$WORK/$APPIMAGE_NAME"

	# A partir de aquí todo está verificado: ya se puede escribir en el sistema (con la app cerrada).
	ensure_app_closed
	mkdir -p "$KNIVCHIT_DATA_DIR"
	install_binary
	install_icons
	install_desktop_entry
	install_dbus_service
	install_extension
	migrate_legacy_shortcuts
	migrate_legacy_autostart
	remove_legacy_install

	echo "Knivchit instalado en $BIN_PATH"
	echo "Lo encontrarás como «Knivchit» en el menú de aplicaciones."
	if [ "$EXT_NOTE" = "activada" ]; then
		echo "La extensión del atajo Super+Shift+C está activada."
	fi
	if [ -n "$EXT_NOTE" ]; then
		echo "Cierra la sesión y vuelve a entrar para que GNOME cargue la extensión (en Wayland no se puede recargar sin cerrar sesión)."
	fi
	if ! have fusermount3 && ! have fusermount; then
		warn "Knivchit es un AppImage y requiere fusermount3/FUSE; no lo encuentro. Instala el paquete 'fuse3' o ejecuta con: $BIN_PATH --appimage-extract-and-run"
	fi
}

usage() { echo "uso: install.sh [--close-app] [--stable | --version <tag>] | --from-dir <carpeta> | --uninstall" >&2; exit 2; }

ACTION=install
while [ $# -gt 0 ]; do
	case "$1" in
	--uninstall) ACTION=uninstall ;;
	--stable) WANT_STABLE=1 ;;
	--close-app) CLOSE_APP=1 ;;
	--version)
		[ -n "${2:-}" ] || usage
		WANT_VERSION="$2"; shift ;;
	--from-dir)
		[ -n "${2:-}" ] || usage
		LOCAL_DIR="$2"; shift ;;
	-h | --help) ACTION=help ;;
	*) usage ;;
	esac
	shift
done
# Combinaciones sin sentido: --stable y --version se excluyen; ni una ni otra valen con --uninstall o --from-dir.
if [ -n "$WANT_VERSION" ] && [ "$WANT_STABLE" = 1 ]; then usage; fi
if { [ -n "$WANT_VERSION" ] || [ "$WANT_STABLE" = 1 ]; } && { [ "$ACTION" != install ] || [ -n "$LOCAL_DIR" ]; }; then usage; fi
if [ -n "$LOCAL_DIR" ] && [ "$ACTION" != install ]; then usage; fi
# La etiqueta va dentro de una URL: solo caracteres de versión (nunca «/», «..» ni «?»).
if [ -n "$WANT_VERSION" ] && ! printf '%s' "$WANT_VERSION" | grep -Eq '^v?[0-9]+(\.[0-9]+)*([-+.][0-9A-Za-z.-]+)?$'; then
	die "la versión '$WANT_VERSION' no tiene formato de etiqueta (p. ej. v0.1.0-alpha.1)."
fi

case "$ACTION" in
install) do_install ;;
uninstall) uninstall ;;
help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
