#!/usr/bin/env bash
set -Eeuo pipefail
PACKAGE_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="${1:-$(cd -- "${PACKAGE_ROOT}/../../.." && pwd)}"

[[ -d "${REPO_ROOT}/octobridge-zero/affetta_octobridge" ]] || {
  echo "Modulo OctoBridge non trovato in ${REPO_ROOT}" >&2
  exit 2
}

bash "${PACKAGE_ROOT}/tests/run-static-tests.sh"
python3 "${PACKAGE_ROOT}/tests/validate_lab_package.py" --root "${PACKAGE_ROOT}"
python3 "${PACKAGE_ROOT}/tests/test_fake_octoprint.py"
python3 -m compileall -q "${REPO_ROOT}/octobridge-zero/affetta_octobridge" "${PACKAGE_ROOT}"
PYTHONPATH="${REPO_ROOT}/octobridge-zero" python3 -m unittest discover -s "${REPO_ROOT}/octobridge-zero/tests" -v
node --test "${REPO_ROOT}"/server-lite/test/*.test.js
node "${PACKAGE_ROOT}/tests/e2e_server_lite_adapter.mjs" --repo-root "${REPO_ROOT}"
python3 "${PACKAGE_ROOT}/tests/e2e_octobridge_readiness.py" --repo-root "${REPO_ROOT}"

printf '\n[OK] Readiness software OctoBridge completata. Hardware ancora da collaudare.\n'
