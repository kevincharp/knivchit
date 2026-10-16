#!/usr/bin/env bash
# Prueba extension/package.sh: contenido de los dos zips (el de GitHub/install.sh y el
# de extensions.gnome.org con --ego). Uso: bash extension/package.test.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }
listing() { python3 -c 'import sys, zipfile; print("\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))' "$1"; }

normal=$("$HERE/package.sh" "$OUT/normal")
ego=$("$HERE/package.sh" --ego "$OUT/ego")
[ -f "$normal" ] || fail "no se generó el zip normal"
[ -f "$ego" ] || fail "no se generó el zip --ego"
case "$normal" in "$OUT"/normal/knivchit-extension-v*.zip) ;; *) fail "ruta inesperada del zip normal: $normal" ;; esac
case "$ego" in "$OUT"/ego/knivchit-extension-v*.zip) ;; *) fail "ruta inesperada del zip --ego: $ego" ;; esac
[ ! -e "$HERE/--ego" ] || { rm -rf "$HERE/--ego"; fail "package.sh trató --ego como un directorio de salida"; }

for z in "$normal" "$ego"; do
	l=$(listing "$z")
	for f in extension.js metadata.json LICENSE schemas/org.gnome.shell.extensions.knivchit.gschema.xml lib/shortcuts.js lib/windowPlacement.js; do
		grep -qx "$f" <<<"$l" || fail "$z no contiene $f"
	done
	if grep -qE '^tests/|package' <<<"$l"; then fail "$z incluye tests/ o los scripts de empaquetado"; fi
done
listing "$normal" | grep -qx "schemas/gschemas.compiled" || fail "el zip normal debe incluir gschemas.compiled (se instala sin pasar por gnome-extensions)"
if listing "$ego" | grep -q "gschemas.compiled"; then fail "el zip --ego no debe incluir gschemas.compiled (lo compila extensions.gnome.org)"; fi

# el mismo contenido, salvo el esquema compilado
diff <(listing "$normal" | grep -v gschemas.compiled) <(listing "$ego") >/dev/null || fail "los dos zips deberían diferir solo en gschemas.compiled"
echo "PASS: package.sh genera el zip de GitHub (con esquema compilado) y el de extensions.gnome.org (--ego, sin compilado), sin tests ni scripts"
