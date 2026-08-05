#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SOURCE="/var/lib/affetta-octobridge/registration/server-lite-registration.json"
TARGET_USER="${SUDO_USER:-${USER}}"
TARGET_HOME="$(getent passwd "${TARGET_USER}" | cut -d: -f6)"
[[ -n "${TARGET_HOME}" ]] || { echo "Home utente non trovato." >&2; exit 1; }
[[ -f "${SOURCE}" ]] || { echo "Registrazione non trovata: ${SOURCE}" >&2; exit 1; }

UNIT_ID="$(python3 - "${SOURCE}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["printer"]["id"])
PY
)"
DEST="${TARGET_HOME}/${UNIT_ID}.server-lite-registration.json"
install -o "${TARGET_USER}" -g "$(id -gn "${TARGET_USER}")" -m 0600 "${SOURCE}" "${DEST}"
printf 'Registrazione esportata in: %s\n' "${DEST}"
printf 'Contiene un token segreto: copiarla sul PC Affetta e cancellarla dal percorso temporaneo dopo l’importazione.\n'
