#!/usr/bin/env bash
# Mantiene coherentes un issue y sus sub-issues cuando se cierra uno.
# Entradas por entorno: REPO (dueño/repo), ISSUE (número del issue recién cerrado), GH_TOKEN.
set -euo pipefail

# Números de los sub-issues abiertos de un issue, uno por línea.
abiertos_de() {
  gh api "repos/$REPO/issues/$1/sub_issues" --paginate --jq '.[] | select(.state == "open") | "#\(.number)"'
}

abiertos=$(abiertos_de "$ISSUE" | paste -sd, | sed 's/,/, /g')

# Un padre con sub-issues abiertos no puede quedar cerrado.
if [ -n "$abiertos" ]; then
  gh issue reopen "$ISSUE" --repo "$REPO" \
    --comment "Se reabre: tiene sub-issues abiertos ($abiertos)."
  exit 0
fi

# Si era el último hijo abierto, el padre se cierra como completado, aunque el hijo se haya cerrado como no planeado.
# Sin padre la API responde 404; el cuerpo del error no debe tomarse como número.
padre=$(gh api "repos/$REPO/issues/$ISSUE/parent" --jq .number 2>/dev/null) || exit 0

pendientes=$(abiertos_de "$padre")
estado=$(gh issue view "$padre" --repo "$REPO" --json state --jq .state)

if [ -z "$pendientes" ] && [ "$estado" = OPEN ]; then
  gh issue close "$padre" --repo "$REPO" --reason completed \
    --comment "Se cierra: todos sus sub-issues están cerrados."
fi
