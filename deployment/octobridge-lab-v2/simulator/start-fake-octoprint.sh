#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/fake_octoprint.py" \
  --host "${AFFETTA_FAKE_OCTOPRINT_HOST:-127.0.0.1}" \
  --port "${AFFETTA_FAKE_OCTOPRINT_PORT:-5000}" \
  --api-key "${AFFETTA_FAKE_OCTOPRINT_API_KEY:-AFFETTA_FAKE_OCTOPRINT_KEY}" \
  --control-key "${AFFETTA_SIMULATOR_CONTROL_KEY:-AFFETTA_SIMULATOR_CONTROL}" \
  --data-dir "${AFFETTA_FAKE_OCTOPRINT_DATA:-${TMPDIR:-/tmp}/affetta-fake-octoprint}"
