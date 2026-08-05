#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

CONFIG="/etc/affetta-octobridge/config.json"
CATALOG="/opt/affetta-octobridge/config/printer-catalog.json"

[[ "${EUID}" -eq 0 ]] || { echo "Eseguire con sudo." >&2; exit 1; }
[[ -f "${CONFIG}" ]] || { echo "Config non trovata." >&2; exit 1; }

BRIDGE_ID="$(python3 - "${CONFIG}" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle)["bridge_id"])
PY
)"

printf 'Questa operazione abilita la stampa seriale SPERIMENTALE per %s.\n' "${BRIDGE_ID}"
printf 'Non imposta production_ready=true.\n'
read -rp "Digitare esattamente il bridge ID per confermare: " CONFIRM
[[ "${CONFIRM}" == "${BRIDGE_ID}" ]] || { echo "Conferma non valida." >&2; exit 1; }

python3 - "${CONFIG}" <<'PY'
import json, os, sys, tempfile
path = sys.argv[1]
with open(path, encoding="utf-8") as handle:
    cfg = json.load(handle)
cfg["serial_printing_enabled"] = True
cfg["physical_validation_stage"] = "experimental_testing"
cfg["release_channel"] = "experimental"
cfg["production_ready"] = False
fd, tmp = tempfile.mkstemp(prefix=".config.json.", dir=os.path.dirname(path))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(cfg, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(tmp, 0o640)
    os.replace(tmp, path)
finally:
    try:
        os.unlink(tmp)
    except FileNotFoundError:
        pass
PY

chown root:octobridge "${CONFIG}"
chmod 0640 "${CONFIG}"
python3 /opt/affetta-octobridge/scripts/validate_config.py --config "${CONFIG}" --catalog "${CATALOG}"
systemctl restart affetta-octobridge.service
systemctl --no-pager --full status affetta-octobridge.service
