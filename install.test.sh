#!/usr/bin/env bash
# Prueba install.sh contra un entorno aislado: nunca toca ~/.local real ni la
# red real. El «release» es un directorio servido por file:// (o por un
# servidor HTTP local para el caso 404), todos los directorios KNIVCHIT_* y
# HOME/XDG_* apuntan a un árbol temporal y gnome-extensions/gsettings son
# dobles que solo registran lo que se les pide. Uso: bash install.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(mktemp -d)"
SERVER_PID=""
API_PID=""
cleanup() {
	[ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
	[ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
	rm -rf "$ROOT"
}
trap cleanup EXIT

fail() {
	echo "FAIL [${CASE:-?}]: $1" >&2
	[ -f "${OUT:-/nonexistent}" ] && { echo "--- salida de install.sh ---" >&2; cat "$OUT" >&2; }
	exit 1
}
contains() { grep -qF -- "$2" "$1" || fail "$1 no contiene '$2' (contenido: $(cat "$1" 2>/dev/null))"; }
absent() { [ ! -e "$1" ] || fail "no debería existir $1"; }
present() { [ -e "$1" ] || fail "debería existir $1"; }

# --- Un PNG válido de lado N, y un «AppImage» falso que sabe extraer iconos ---
make_fake_appimage() { # destino
	cat >"$1" <<'EOF'
#!/usr/bin/env bash
# AppImage de prueba: solo implementa lo que install.sh le pide.
if [ "${1:-}" = "--appimage-extract" ]; then
	python3 - <<'PY'
import os, struct, zlib
def png(n):
    raw = b"".join(b"\x00" + b"\x10\x20\x30\xff" * n for _ in range(n))
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
# Tauri nombra 256 px como «256x256@2»: el instalador debe usar el tamaño REAL.
for d, n in (("32x32", 32), ("128x128", 128), ("256x256@2", 256)):
    p = f"squashfs-root/usr/share/icons/hicolor/{d}/apps"
    os.makedirs(p, exist_ok=True)
    open(f"{p}/knivchit.png", "wb").write(png(n))
PY
	exit 0
fi
echo "Knivchit falso"
EOF
	chmod +x "$1"
}

# --- API de GitHub simulada: un servidor para todos los casos -----------------------------
# GET /<caso>/releases?per_page=10  -> $ROOT/<caso>/api/list.json
# GET /<caso>/releases/latest       -> $ROOT/<caso>/api/latest.json   (404 si no existe)
# GET /<caso>/releases/tags/<tag>   -> $ROOT/<caso>/api/tags/<tag>.json
cat >"$ROOT/api_server.py" <<'PY'
import http.server, os, sys, urllib.parse
ROOT = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path.strip("/").split("/")
        case, rest = path[0], path[1:]
        base = os.path.join(ROOT, case, "api")
        if rest == ["releases"]: f = "list.json"
        elif rest == ["releases", "latest"]: f = "latest.json"
        elif len(rest) == 3 and rest[:2] == ["releases", "tags"] and "/" not in rest[2] and ".." not in rest[2]: f = os.path.join("tags", rest[2] + ".json")
        else: f = None
        full = os.path.join(base, f) if f else None
        if not full or not os.path.isfile(full):
            self.send_response(404); self.end_headers(); self.wfile.write(b'{"message":"Not Found"}'); return
        body = open(full, "rb").read()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = http.server.HTTPServer(("127.0.0.1", 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
PY
python3 "$ROOT/api_server.py" "$ROOT" >"$ROOT/api_port" 2>/dev/null &
API_PID=$!
for _ in $(seq 1 50); do [ -s "$ROOT/api_port" ] && break; sleep 0.1; done
API_PORT=$(cat "$ROOT/api_port")

# --- Entorno nuevo por caso: release falso + HOME aislado + dobles en PATH ---
new_env() { # nombre
	CASE="$1"
	E="$ROOT/$1"
	mkdir -p "$E/release" "$E/api/tags" "$E/home" "$E/fakebin"
	make_fake_appimage "$E/release/knivchit_0.1.0_amd64.AppImage"
	python3 - "$E/release/knivchit-extension-v0.1.0.zip" <<'PY'
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("metadata.json", '{"uuid": "knivchit@knivchit.dev"}')
PY
	(cd "$E/release" && sha256sum knivchit_0.1.0_amd64.AppImage knivchit-extension-v0.1.0.zip >SHA256SUMS)
	write_release_json all

	# dobles: registran las llamadas; STUB_ENABLE_FAIL=1 hace fallar `enable`
	cat >"$E/fakebin/gnome-extensions" <<EOF
#!/usr/bin/env bash
echo "\$*" >>"$E/calls.log"
[ "\${1:-}" = enable ] && [ "\${STUB_ENABLE_FAIL:-}" = 1 ] && exit 2
exit 0
EOF
	cat >"$E/fakebin/gsettings" <<EOF
#!/usr/bin/env bash
echo "gsettings \$*" >>"$E/calls.log"
if [ "\${1:-}" = --schemadir ]; then
	shift 2
	mkdir -p "$E/gs"
	case "\$1" in
	get) if [ -f "$E/gs/\$3" ]; then cat "$E/gs/\$3"; else echo "@as []"; fi ;;
	set) printf '%s' "\$4" >"$E/gs/\$3" ;;
	esac
	exit 0
fi
if [ "\$1" = get ]; then cat "$E/enabled" 2>/dev/null || echo "@as []"; fi
if [ "\$1" = set ]; then printf '%s' "\$4" >"$E/enabled"; fi
EOF
	chmod +x "$E/fakebin/gnome-extensions" "$E/fakebin/gsettings"

	export HOME="$E/home" XDG_DATA_HOME="$E/home/.local/share" XDG_CONFIG_HOME="$E/home/.config"
	export PATH="$E/fakebin:$ORIG_PATH"
	export KNIVCHIT_API_BASE="http://127.0.0.1:$API_PORT/$1"
	export KNIVCHIT_BIN_DIR="$E/bin" KNIVCHIT_DESKTOP_DIR="$E/applications" KNIVCHIT_DATA_DIR="$E/knivchit"
	export KNIVCHIT_DBUS_SERVICE_DIR="$E/dbus-services" KNIVCHIT_ICON_DIR="$E/icons"
	export KNIVCHIT_AUTOSTART_DIR="$E/autostart"
	OUT="$E/out.log"
	BIN_PATH="$E/bin/knivchit"
	SERVICE_PATH="$E/dbus-services/org.knivchit.App.service"
	DESKTOP_PATH="$E/applications/knivchit.desktop"
	export KNIVCHIT_ALLOW_INSECURE_API=1 # la API simulada de las pruebas es http://127.0.0.1
	unset STUB_ENABLE_FAIL
}

write_release_json() { # all | sin-zip | sin-sums  -> latest.json, list.json y tags/v0.1.0.json de la API simulada
	python3 - "$E/release" "$E/api" "$1" <<'PY'
import json, sys
d, api, mode = sys.argv[1], sys.argv[2], sys.argv[3]
assets = [("knivchit_0.1.0_amd64.AppImage", True), ("knivchit-extension-v0.1.0.zip", mode != "sin-zip"), ("SHA256SUMS", mode != "sin-sums")]
rel = {"tag_name": "v0.1.0", "draft": False, "prerelease": False, "published_at": "2026-10-15T12:00:00Z",
       "assets": [{"name": n, "browser_download_url": f"file://{d}/{n}"} for n, keep in assets if keep]}
json.dump(rel, open(f"{api}/latest.json", "w"))
json.dump([rel], open(f"{api}/list.json", "w"))
json.dump(rel, open(f"{api}/tags/v0.1.0.json", "w"))
PY
}

# Publica una lista de releases en la API simulada: "tag:pre|stable:fecha[:draft]" ...
# Todos comparten los mismos archivos (el AppImage/zip/sumas del caso); lo que cambia es la etiqueta.
write_release_list() {
	python3 - "$E/release" "$E/api" "$@" <<'PY'
import json, sys
d, api, specs = sys.argv[1], sys.argv[2], sys.argv[3:]
names = ["knivchit_0.1.0_amd64.AppImage", "knivchit-extension-v0.1.0.zip", "SHA256SUMS"]
def rel(spec):
    parts = spec.split(":"); tag, kind, date = parts[0], parts[1], parts[2]
    return {"tag_name": tag, "draft": "draft" in parts[3:], "prerelease": kind == "pre", "published_at": date,
            "assets": [{"name": n, "browser_download_url": f"file://{d}/{n}"} for n in names]}
rels = [rel(x) for x in specs]
json.dump(rels, open(f"{api}/list.json", "w"))
stables = sorted([r for r in rels if not r["prerelease"] and not r["draft"]], key=lambda r: r["published_at"], reverse=True)
latest = f"{api}/latest.json"
import os
if stables: json.dump(stables[0], open(latest, "w"))
elif os.path.exists(latest): os.remove(latest)  # sin estables, /releases/latest da 404 como en GitHub
for r in rels: json.dump(r, open(f"{api}/tags/{r['tag_name']}.json", "w"))
PY
}

install_ok() { timeout 60 bash "$SCRIPT_DIR/install.sh" >"$OUT" 2>&1 </dev/null || fail "install.sh debería haber terminado bien"; }
install_fails() { if timeout 60 bash "$SCRIPT_DIR/install.sh" >"$OUT" 2>&1 </dev/null; then fail "install.sh debería haber fallado"; fi; }

ORIG_PATH="$PATH"

# 1. Camino feliz --------------------------------------------------------------
new_env feliz
install_ok
[ -x "$BIN_PATH" ] || fail "el binario no quedó ejecutable en $BIN_PATH"
cmp -s "$BIN_PATH" "$E/release/knivchit_0.1.0_amd64.AppImage" || fail "el binario instalado no es el del release"
contains "$SERVICE_PATH" "[D-BUS Service]"
contains "$SERVICE_PATH" "Name=org.knivchit.App"
contains "$SERVICE_PATH" "Exec=$BIN_PATH --hidden"
for l in "Type=Application" "Name=Knivchit" "Exec=$BIN_PATH" "Icon=knivchit" "Terminal=false" \
	"Categories=Utility;GTK;GNOME;" "StartupNotify=true" "StartupWMClass=knivchit" "Keywords="; do
	contains "$DESKTOP_PATH" "$l"
done
grep -q '^Comment=' "$DESKTOP_PATH" || fail "el .desktop no tiene Comment"
if command -v desktop-file-validate >/dev/null 2>&1; then
	desktop-file-validate "$DESKTOP_PATH" || fail "desktop-file-validate rechaza el .desktop"
fi
# iconos: por su tamaño REAL (el de 256 px viene en «256x256@2»)
for s in 32 128 256; do present "$E/icons/hicolor/${s}x${s}/apps/knivchit.png"; done
absent "$E/icons/hicolor/256x256@2"
# extensión: instalada desde el zip y habilitada
contains "$E/calls.log" "install --force "
contains "$E/calls.log" "enable knivchit@knivchit.dev"
contains "$OUT" "Cierra la sesión"

# 2. Idempotencia: otra pasada no duplica ni falla ------------------------------
install_ok
[ "$(grep -c '^Name=' "$SERVICE_PATH")" = 1 ] || fail "la segunda instalación duplicó Name= en el .service"
contains "$SERVICE_PATH" "Exec=$BIN_PATH --hidden"

# 3. Desinstalar lo revierte TODO (incluye iconos, autostart y la extensión) ------
mkdir -p "$E/autostart" "$E/knivchit"; echo x >"$E/autostart/knivchit.desktop"; echo x >"$E/knivchit/knivchit.log"
bash "$SCRIPT_DIR/install.sh" --uninstall >"$OUT" 2>&1 || fail "--uninstall falló"
for p in "$BIN_PATH" "$SERVICE_PATH" "$DESKTOP_PATH" "$E/autostart/knivchit.desktop" "$E/knivchit" \
	"$E/icons/hicolor/32x32/apps/knivchit.png" "$E/icons/hicolor/128x128/apps/knivchit.png" "$E/icons/hicolor/256x256/apps/knivchit.png"; do
	absent "$p"
done
contains "$E/calls.log" "uninstall knivchit@knivchit.dev"

# 4. Suma sha256 que no coincide: no se instala NADA y no se pisa lo que había ---
new_env suma-mala
mkdir -p "$E/bin"; echo "version anterior" >"$BIN_PATH"
echo "alterado" >>"$E/release/knivchit_0.1.0_amd64.AppImage"
install_fails
contains "$OUT" "sha256"
[ "$(cat "$BIN_PATH")" = "version anterior" ] || fail "una descarga corrupta pisó el binario existente"
absent "$SERVICE_PATH"; absent "$DESKTOP_PATH"; absent "$E/calls.log"

# 5. El release no trae SHA256SUMS: se rechaza (no se instala sin verificar) -----
new_env sin-sums
write_release_json sin-sums
install_fails
contains "$OUT" "SHA256SUMS"
absent "$BIN_PATH"

# 6. SHA256SUMS sin la entrada del AppImage: se rechaza ---------------------------
new_env sums-incompleto
grep -v AppImage "$E/release/SHA256SUMS" >"$E/release/SHA256SUMS.new" && mv "$E/release/SHA256SUMS.new" "$E/release/SHA256SUMS"
install_fails
contains "$OUT" "knivchit_0.1.0_amd64.AppImage"
absent "$BIN_PATH"

# 7. Todavía no hay release publicado (HTTP 404): mensaje claro, nada instalado ---
new_env sin-release
mkdir -p "$E/vacio"
PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
(cd "$E/vacio" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
SERVER_PID=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
export KNIVCHIT_API_BASE="http://127.0.0.1:$PORT"
install_fails
contains "$OUT" "No hay ningún release publicado"
absent "$BIN_PATH"; absent "$SERVICE_PATH"
kill "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""

# 8. Release sin zip de la extensión: la app se instala y se avisa ----------------
new_env sin-zip
write_release_json sin-zip
install_ok
present "$BIN_PATH"
contains "$OUT" "extensión"
absent "$E/calls.log"

# 9. Sin gnome-extensions (otro escritorio): la app se instala igual, con aviso ----
new_env sin-gnome-extensions
rm -f "$E/fakebin/gnome-extensions"
SAFE_PATH="$E/fakebin"; for t in bash env cat awk sed grep sha256sum curl python3 mktemp mkdir rm mv cp chmod find tr cut sort head dirname basename cmp install ls; do p=$(command -v "$t" 2>/dev/null || true); [ -n "$p" ] && ln -sf "$p" "$E/fakebin/$t"; done
PATH="$SAFE_PATH" bash "$SCRIPT_DIR/install.sh" >"$OUT" 2>&1 || fail "sin gnome-extensions la instalación debería terminar bien"
present "$BIN_PATH"
contains "$OUT" "gnome-extensions"

# 10. La extensión recién instalada aún no la conoce el Shell: `enable` falla y se
#     deja habilitada para el próximo inicio de sesión vía gsettings ---------------
new_env enable-falla
echo "['otra@ext.dev']" >"$E/enabled"
export STUB_ENABLE_FAIL=1
install_ok
contains "$E/calls.log" "gsettings set org.gnome.shell enabled-extensions"
grep -q "otra@ext.dev" "$E/enabled" || fail "se perdió una extensión ya habilitada"
grep -q "knivchit@knivchit.dev" "$E/enabled" || fail "no se añadió knivchit@knivchit.dev a enabled-extensions"
install_ok  # y otra pasada no la añade dos veces
[ "$(grep -o 'knivchit@knivchit.dev' "$E/enabled" | wc -l)" = 1 ] || fail "knivchit@knivchit.dev quedó duplicada en enabled-extensions"
unset STUB_ENABLE_FAIL

# 11. Ruta de instalación con espacios: se rechaza (rompería Exec= del .desktop/.service)
new_env ruta-con-espacios
export KNIVCHIT_BIN_DIR="$E/con espacio"
install_fails
contains "$OUT" "espacios"

# 12. Migración desde ViewClip: atajos, autoarranque y restos viejos ----------------
new_env migracion
LEG_EXT="$E/home/.local/share/gnome-shell/extensions/viewclip@viewclip.dev"
NEW_EXT="$E/home/.local/share/gnome-shell/extensions/knivchit@knivchit.dev"
mkdir -p "$LEG_EXT/schemas" "$NEW_EXT/schemas" "$E/bin" "$E/applications" "$E/dbus-services" "$E/autostart" \
	"$E/icons/hicolor/32x32/apps" "$E/gs"
touch "$LEG_EXT/schemas/gschemas.compiled" "$NEW_EXT/schemas/gschemas.compiled"
# La migración valida los atajos con las reglas de la extensión instalada (lib/shortcuts.js).
mkdir -p "$NEW_EXT/lib" && cp "$SCRIPT_DIR/extension/lib/shortcuts.js" "$NEW_EXT/lib/shortcuts.js"
echo "['<Super><Shift>c']" >"$E/gs/viewclip-start-capture"
echo "['<Super>e']" >"$E/gs/viewclip-open-emoji"
echo "['<Control>v']" >"$E/gs/viewclip-open-clipboard" # reservado: la extensión vieja lo aceptaba, no se hereda
echo "['<Super>x']" >"$E/gs/knivchit-open-emoji" # el nuevo ya tenía algo: no se pisa
echo x >"$E/bin/viewclip"; echo x >"$E/applications/viewclip.desktop"
echo x >"$E/dbus-services/org.viewclip.App.service"; echo x >"$E/autostart/viewclip.desktop"
echo x >"$E/icons/hicolor/32x32/apps/viewclip.png"
mkdir -p "$E/home/.local/share/viewclip" && echo x >"$E/home/.local/share/viewclip/viewclip.log"  # LEGACY_DATA_DIR
mkdir -p "$E/viewclip" && echo "no es de Knivchit" >"$E/viewclip/notas.txt" # hermano de KNIVCHIT_DATA_DIR: NO se toca
echo "['viewclip@viewclip.dev', 'otra@ext.dev']" >"$E/enabled"
mkdir -p "$E/org.viewclip.app" && echo datos >"$E/org.viewclip.app/viewclip.db"
install_ok
[ "$(cat "$E/gs/knivchit-start-capture")" = "['<Super><Shift>c']" ] || fail "no se migró el atajo de captura"
[ "$(cat "$E/gs/knivchit-open-emoji")" = "['<Super>x']" ] || fail "la migración pisó un atajo ya definido en el esquema nuevo"
[ ! -e "$E/gs/knivchit-open-clipboard" ] || fail "se migró un atajo vacío o reservado (<Control>v)"
contains "$E/out.log" "reservado"
contains "$E/viewclip/notas.txt" "no es de Knivchit"
contains "$E/calls.log" "disable viewclip@viewclip.dev"
contains "$E/calls.log" "uninstall viewclip@viewclip.dev"
absent "$LEG_EXT"; present "$NEW_EXT"
for p in "$E/bin/viewclip" "$E/applications/viewclip.desktop" "$E/dbus-services/org.viewclip.App.service" \
	"$E/autostart/viewclip.desktop" "$E/icons/hicolor/32x32/apps/viewclip.png" "$E/home/.local/share/viewclip"; do
	absent "$p"
done
present "$BIN_PATH"
contains "$E/autostart/knivchit.desktop" "Exec=\"$BIN_PATH\" --hidden"
grep -q "viewclip@viewclip.dev" "$E/enabled" && fail "la extensión vieja sigue en enabled-extensions"
grep -q "otra@ext.dev" "$E/enabled" || fail "se perdió otra extensión habilitada"
# la copia de datos de la app es cosa de la app: el instalador NO borra org.viewclip.app
contains "$E/org.viewclip.app/viewclip.db" "datos"
install_ok # idempotente: sin restos viejos no falla ni toca nada

# 13. Borrados con guardas: una variable mal puesta NO borra carpetas ajenas ----------
uninstall_in() { # nombre-del-caso, resto: VAR=valor...
	new_env "$1"; shift
	env "$@" bash "$SCRIPT_DIR/install.sh" --uninstall >"$OUT" 2>&1 || true
}
# a) un proyecto del usuario con nombre «viewclip» al lado del directorio de datos
mkdir -p "$ROOT/borra-a/proyectos/viewclip" "$ROOT/borra-a/proyectos/knivchit"
echo trabajo >"$ROOT/borra-a/proyectos/viewclip/notas.txt"; echo x >"$ROOT/borra-a/proyectos/knivchit/knivchit.log"
uninstall_in borra-a KNIVCHIT_DATA_DIR="$ROOT/borra-a/proyectos/knivchit"
present "$ROOT/borra-a/proyectos/viewclip/notas.txt"; absent "$ROOT/borra-a/proyectos/knivchit"
# b) la variable apunta por error a una carpeta de datos del usuario (nombre base distinto)
mkdir -p "$ROOT/borra-b/documentos"; echo x >"$ROOT/borra-b/documentos/tesis.txt"
uninstall_in borra-b KNIVCHIT_DATA_DIR="$ROOT/borra-b/documentos"
present "$ROOT/borra-b/documentos/tesis.txt"; contains "$OUT" "no borro"
# c) ruta relativa: ./viewclip y ./knivchit del directorio actual no se tocan
mkdir -p "$ROOT/borra-c/cwd/knivchit" "$ROOT/borra-c/cwd/viewclip"; echo x >"$ROOT/borra-c/cwd/knivchit/a.txt"; echo x >"$ROOT/borra-c/cwd/viewclip/a.txt"
new_env borra-c; (cd "$ROOT/borra-c/cwd" && KNIVCHIT_DATA_DIR=knivchit bash "$SCRIPT_DIR/install.sh" --uninstall >"$OUT" 2>&1) || true
present "$ROOT/borra-c/cwd/knivchit/a.txt"; present "$ROOT/borra-c/cwd/viewclip/a.txt"
# d) «/», $HOME, un antecesor de $HOME y «..»: nada se borra
for bad in / "$ROOT/borra-d/home" "$ROOT/borra-d" "$ROOT/borra-d/home/../home/knivchit"; do
	new_env borra-d; mkdir -p "$ROOT/borra-d/home/knivchit"; echo x >"$ROOT/borra-d/home/doc.txt"; echo x >"$ROOT/borra-d/home/knivchit/a.txt"
	env HOME="$ROOT/borra-d/home" KNIVCHIT_DATA_DIR="$bad" bash "$SCRIPT_DIR/install.sh" --uninstall >"$OUT" 2>&1 || true
	present "$ROOT/borra-d/home/doc.txt"; present "$ROOT/borra-d/home/knivchit/a.txt"
done
# e) el directorio correcto, pero con archivos ajenos dentro: solo se quitan sus logs
mkdir -p "$ROOT/borra-e/knivchit"; echo x >"$ROOT/borra-e/knivchit/knivchit.log"; echo mio >"$ROOT/borra-e/knivchit/mio.txt"
uninstall_in borra-e KNIVCHIT_DATA_DIR="$ROOT/borra-e/knivchit"
absent "$ROOT/borra-e/knivchit/knivchit.log"; present "$ROOT/borra-e/knivchit/mio.txt"; contains "$OUT" "otros archivos"
# f) enlace simbólico llamado knivchit hacia una carpeta del usuario: no se sigue
mkdir -p "$ROOT/borra-f/real"; echo x >"$ROOT/borra-f/real/doc.txt"; ln -s "$ROOT/borra-f/real" "$ROOT/borra-f/knivchit"
uninstall_in borra-f KNIVCHIT_DATA_DIR="$ROOT/borra-f/knivchit"
present "$ROOT/borra-f/real/doc.txt"
# g) el directorio viejo de datos solo se borra si contiene únicamente logs de viewclip
new_env borra-g
mkdir -p "$E/home/.local/share/viewclip"; echo x >"$E/home/.local/share/viewclip/viewclip.log"; echo mio >"$E/home/.local/share/viewclip/otro.db"
install_ok
present "$E/home/.local/share/viewclip/otro.db"; absent "$E/home/.local/share/viewclip/viewclip.log"

# 14. KNIVCHIT_BIN_DIR con caracteres que Exec= interpretaría, o relativa: se rechaza --
for bad in 'rel/bin' '/tmp/a"b' '/tmp/a$(x)b' '/tmp/a%b' '/tmp/a;b' '/tmp/a\b' '/tmp/a`b`'; do
	new_env exec-malo
	export KNIVCHIT_BIN_DIR="$bad"
	install_fails
	contains "$OUT" "KNIVCHIT_BIN_DIR"
	absent "$E/calls.log"
done


# 15. Modo local --from-dir: verifica sumas, instala igual y no toca la red -----------
local_install() { timeout 60 bash "$SCRIPT_DIR/install.sh" --from-dir "$1" >"$OUT" 2>&1 </dev/null; }
local_ok() { local_install "$1" || fail "install.sh --from-dir debería haber terminado bien"; }
local_fails() { if local_install "$1"; then fail "install.sh --from-dir debería haber fallado"; fi; }
no_network() { # un curl espía que falla y deja huella, y una API inalcanzable
	printf '#!/usr/bin/env bash\necho "curl llamado: $*" >>"%s/curl-llamado"\nexit 7\n' "$E" >"$E/fakebin/curl"
	chmod +x "$E/fakebin/curl"
	export KNIVCHIT_API_BASE="http://127.0.0.1:9/inalcanzable"
}
new_env local-feliz
no_network
local_ok "$E/release"
cmp -s "$BIN_PATH" "$E/release/knivchit_0.1.0_amd64.AppImage" || fail "el binario instalado no es el de la carpeta"
contains "$SERVICE_PATH" "Exec=$BIN_PATH --hidden"
contains "$E/calls.log" "install --force "
contains "$E/calls.log" "enable knivchit@knivchit.dev"
contains "$OUT" "sin red"
absent "$E/curl-llamado"
local_ok "$E/release" # idempotente
# a) suma incorrecta: no se instala nada y no se pisa lo anterior
new_env local-suma-mala
no_network
mkdir -p "$E/bin"; echo "version anterior" >"$BIN_PATH"
echo "alterado" >>"$E/release/knivchit_0.1.0_amd64.AppImage"
local_fails "$E/release"
contains "$OUT" "sha256"
[ "$(cat "$BIN_PATH")" = "version anterior" ] || fail "una carpeta con suma mala pisó el binario existente"
absent "$SERVICE_PATH"; absent "$E/curl-llamado"
# b) sin SHA256SUMS, sin AppImage, más de un AppImage, carpeta inexistente, nombre raro
new_env local-sin-sums; no_network
rm "$E/release/SHA256SUMS"; local_fails "$E/release"; contains "$OUT" "SHA256SUMS"; absent "$BIN_PATH"
new_env local-sin-appimage; no_network
rm "$E/release/knivchit_0.1.0_amd64.AppImage"; local_fails "$E/release"; contains "$OUT" "AppImage"; absent "$BIN_PATH"
new_env local-dos-appimages; no_network
cp "$E/release/knivchit_0.1.0_amd64.AppImage" "$E/release/otro.AppImage"; local_fails "$E/release"; contains "$OUT" "más de un"; absent "$BIN_PATH"
new_env local-no-existe; no_network
local_fails "$E/no-existe"; contains "$OUT" "no es una carpeta"; absent "$BIN_PATH"
new_env local-nombre-raro; no_network
cp "$E/release/knivchit_0.1.0_amd64.AppImage" "$E/release/mi candidato.AppImage"; rm "$E/release/knivchit_0.1.0_amd64.AppImage"
local_fails "$E/release"; contains "$OUT" "no permitidos"; absent "$BIN_PATH"
# c) sin zip de la extensión: la app se instala y se avisa
new_env local-sin-zip; no_network
rm "$E/release/knivchit-extension-v0.1.0.zip"; (cd "$E/release" && sha256sum knivchit_0.1.0_amd64.AppImage >SHA256SUMS)
local_ok "$E/release"; present "$BIN_PATH"; contains "$OUT" "extensión"; absent "$E/calls.log"
# d) uso incorrecto
new_env local-uso
if bash "$SCRIPT_DIR/install.sh" --from-dir >"$OUT" 2>&1; then fail "--from-dir sin carpeta debería fallar"; fi
contains "$OUT" "uso:"


# 16. Qué release se elige: pre-releases, --stable, --version, lista vacía y JSON roto -------
run_install() { timeout 60 bash "$SCRIPT_DIR/install.sh" "$@" >"$OUT" 2>&1 </dev/null; }
run_ok() { run_install "$@" || fail "install.sh $* debería haber terminado bien"; }
run_fails() { if run_install "$@"; then fail "install.sh $* debería haber fallado"; fi; }
# a) solo hay un pre-release (el primer release será una alpha): GitHub "latest" da 404
new_env pre-solo
write_release_list "v0.1.0-alpha.1:pre:2026-10-16T10:00:00Z"
run_ok
contains "$OUT" "instalando PRE-RELEASE v0.1.0-alpha.1"
present "$BIN_PATH"
run_ok --version v0.1.0-alpha.1
contains "$OUT" "instalando PRE-RELEASE v0.1.0-alpha.1"
new_env pre-solo-stable
write_release_list "v0.1.0-alpha.1:pre:2026-10-16T10:00:00Z"
run_fails --stable
contains "$OUT" "ESTABLE"
absent "$BIN_PATH"
new_env pre-version-inexistente
write_release_list "v0.1.0-alpha.1:pre:2026-10-16T10:00:00Z"
run_fails --version v9.9.9
contains "$OUT" "no existe el release"
absent "$BIN_PATH"
# b) pre-release más reciente + estable más antiguo: por defecto el más reciente por fecha; --stable, el estable
new_env pre-y-estable
write_release_list "v0.1.0:stable:2026-10-10T10:00:00Z" "v0.2.0-alpha.1:pre:2026-10-15T10:00:00Z"
run_ok
contains "$OUT" "instalando PRE-RELEASE v0.2.0-alpha.1"
run_ok --stable
contains "$OUT" "instalando el release v0.1.0"
if grep -q "PRE-RELEASE" "$OUT"; then fail "--stable no debe anunciar un pre-release"; fi
# c) estable más reciente que el pre-release: por defecto el estable (sin aviso de pre-release)
new_env estable-reciente
write_release_list "v0.2.0-rc.1:pre:2026-10-18T10:00:00Z" "v0.2.0:stable:2026-10-20T10:00:00Z" "v0.3.0:stable:2026-10-25T10:00:00Z:draft"
run_ok
contains "$OUT" "instalando el release v0.2.0"
if grep -q "PRE-RELEASE\|v0.3.0" "$OUT"; then fail "ni el pre-release ni el borrador deben elegirse"; fi
# d) lista vacía o solo borradores: mensaje claro, nada instalado
new_env lista-vacia
write_release_list
echo "[]" >"$E/api/list.json"
run_fails
contains "$OUT" "No hay ningún release publicado"
absent "$BIN_PATH"
new_env solo-borradores
write_release_list "v0.1.0:stable:2026-10-10T10:00:00Z:draft"
run_fails
contains "$OUT" "No hay ningún release publicado"
absent "$BIN_PATH"
# e) JSON roto o con otra forma: se rechaza sin instalar
new_env json-roto
echo "esto no es json {" >"$E/api/list.json"
run_fails
contains "$OUT" "formato esperado"
absent "$BIN_PATH"
new_env json-objeto
echo '{"message":"API rate limit exceeded"}' >"$E/api/list.json"
run_fails
contains "$OUT" "formato esperado"
absent "$BIN_PATH"
# f) nombres de asset con rutas: se descartan (no se usan como ruta local)
new_env asset-con-ruta
write_release_list "v0.1.0-alpha.1:pre:2026-10-16T10:00:00Z"
python3 - "$E/api/list.json" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
for a in d[0]["assets"]:
    if a["name"].endswith(".AppImage"): a["name"] = "../evil.AppImage"
json.dump(d, open(p, "w"))
PY
run_fails
contains "$OUT" "no incluye un .AppImage"
absent "$BIN_PATH"
# g) --version con formato raro y combinaciones sin sentido: se rechazan antes de pedir nada
new_env opciones
for bad in "../x" "v1/2" "x y" "v1?x=1" ""; do
	run_fails --version "$bad"
done
run_fails --stable --version v0.1.0
run_fails --stable --uninstall
run_fails --version v0.1.0 --from-dir "$E/release"
run_fails --stable --from-dir "$E/release"
run_fails --nada
absent "$BIN_PATH"
# h) con una API https se imponen HTTPS y TLS >= 1.2 (el curl espía registra los argumentos)
new_env tls
printf '#!/usr/bin/env bash\necho "$*" >>"%s/curl-args"\nexit 7\n' "$E" >"$E/fakebin/curl"; chmod +x "$E/fakebin/curl"
export KNIVCHIT_API_BASE="https://api.invalid.test/repos/x/y"
run_fails
contains "$E/curl-args" "--proto =https"
contains "$E/curl-args" "--proto-redir =https"
contains "$E/curl-args" "--tlsv1.2"
contains "$E/curl-args" "releases?per_page=10"

# 17. FIN-09: la ayuda dice que las sumas de --from-dir solo detectan corrupción
new_env ayuda
bash "$SCRIPT_DIR/install.sh" --help >"$OUT" 2>&1 || fail "--help debería terminar bien"
contains "$OUT" "NO manipulación"
contains "$OUT" "tiene que ser de confianza"
if grep -q "set -euo" "$OUT"; then fail "--help imprime código del script"; fi

# 18. FIN-07: una API que no es https se rechaza salvo override explícito de pruebas
new_env api-http
printf '#!/usr/bin/env bash\necho "curl llamado: $*" >>"%s/curl-llamado"\nexit 7\n' "$E" >"$E/fakebin/curl"; chmod +x "$E/fakebin/curl"
unset KNIVCHIT_ALLOW_INSECURE_API
run_fails
contains "$OUT" "no es https"
contains "$OUT" "KNIVCHIT_ALLOW_INSECURE_API=1"
absent "$E/curl-llamado"; absent "$BIN_PATH"
export KNIVCHIT_API_BASE="file://$E/release"
run_fails; contains "$OUT" "no es https"; absent "$BIN_PATH"
export KNIVCHIT_ALLOW_INSECURE_API=0
run_fails; contains "$OUT" "no es https" # solo el valor 1 vale
export KNIVCHIT_ALLOW_INSECURE_API=1

# 19. FIN-08: un atajo heredado con comillas o caracteres raros no se vuelca a gsettings
new_env migracion-inyeccion
LEG_EXT="$E/home/.local/share/gnome-shell/extensions/viewclip@viewclip.dev"
NEW_EXT="$E/home/.local/share/gnome-shell/extensions/knivchit@knivchit.dev"
mkdir -p "$LEG_EXT/schemas" "$NEW_EXT/schemas" "$NEW_EXT/lib" "$E/gs"
touch "$LEG_EXT/schemas/gschemas.compiled" "$NEW_EXT/schemas/gschemas.compiled"
cp "$SCRIPT_DIR/extension/lib/shortcuts.js" "$NEW_EXT/lib/shortcuts.js"
printf '%s' "[\"<Super>a'b\"]" >"$E/gs/viewclip-start-capture"
printf '%s' "[\"<Super>a\\\\b\"]" >"$E/gs/viewclip-open-emoji"
printf '%s' "['<Super><Shift>q']" >"$E/gs/viewclip-open-clipboard"
install_ok
[ ! -e "$E/gs/knivchit-start-capture" ] || fail "se migró un atajo con comillas: $(cat "$E/gs/knivchit-start-capture")"
[ ! -e "$E/gs/knivchit-open-emoji" ] || fail "se migró un atajo con barra invertida"
contains "$E/out.log" "no permitidos"
[ "$(cat "$E/gs/knivchit-open-clipboard")" = "['<Super><Shift>q']" ] || fail "el atajo normal sí debía migrarse"

# 20. Un único app_id estable: nombre del .desktop = StartupWMClass = binario; el servicio D-Bus arranca el mismo binario
new_env app-id
install_ok
[ "$(basename "$DESKTOP_PATH" .desktop)" = knivchit ] || fail "el .desktop debe llamarse knivchit.desktop (GNOME deduce el app id del nombre)"
contains "$DESKTOP_PATH" "StartupWMClass=knivchit"
contains "$DESKTOP_PATH" "Name=Knivchit"
contains "$DESKTOP_PATH" "Exec=$BIN_PATH"
contains "$SERVICE_PATH" "Exec=$BIN_PATH --hidden"
[ "$(basename "$BIN_PATH")" = knivchit ] || fail "el binario instalado debe llamarse knivchit"
bash "$SCRIPT_DIR/install.sh" --uninstall >"$OUT" 2>&1 || fail "--uninstall falló"
contains "$OUT" "flatpak permission-reset knivchit"

echo "PASS: install.sh verifica sha256 antes de tocar nada, instala app+servicio D-Bus+.desktop+iconos+extensión, es idempotente, avisa con claridad y --uninstall lo revierte"
