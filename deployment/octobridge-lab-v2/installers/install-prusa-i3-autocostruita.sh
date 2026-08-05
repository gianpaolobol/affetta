#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

UNIT=""
NAME=""
NOZZLE="0.4"
REST=()

while (( $# )); do
    case "$1" in
        --unit) [[ $# -ge 2 ]] || { echo "--unit richiede un valore" >&2; exit 1; }; UNIT="$2"; shift 2 ;;
        --name) [[ $# -ge 2 ]] || { echo "--name richiede un valore" >&2; exit 1; }; NAME="$2"; shift 2 ;;
        --nozzle-mm) [[ $# -ge 2 ]] || { echo "--nozzle-mm richiede un valore" >&2; exit 1; }; NOZZLE="$2"; shift 2 ;;
        *) REST+=("$1"); shift ;;
    esac
done

[[ -n "${UNIT}" ]] || { echo "Uso: $0 --unit 01 [--name ...] [--nozzle-mm 0.4] [opzioni installer]" >&2; exit 1; }
TEMP_MANIFEST="$(mktemp)"
trap 'rm -f -- "${TEMP_MANIFEST}"' EXIT

ARGS=(--unit "${UNIT}" --nozzle-mm "${NOZZLE}" --output "${TEMP_MANIFEST}")
[[ -n "${NAME}" ]] && ARGS+=(--name "${NAME}")
python3 "${ROOT}/lib/create_prusa_manifest.py" "${ARGS[@]}"

exec bash "${ROOT}/lib/install-machine.sh" --manifest "${TEMP_MANIFEST}" "${REST[@]}"
