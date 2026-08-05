#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
exec bash "${ROOT}/lib/install-machine.sh"     --manifest "${ROOT}/machines/taz-01.json"     "$@"
