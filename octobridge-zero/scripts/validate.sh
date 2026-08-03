#!/usr/bin/env bash
set -Eeuo pipefail
FAIL=0
ok(){ echo "[OK] $*"; }
warn(){ echo "[ATTENZIONE] $*"; }
fail(){ echo "[ERRORE] $*"; FAIL=1; }

[[ "$(uname -m)" == "armv6l" ]] && ok "architettura ARMv6" || warn "architettura $(uname -m): il target previsto è armv6l"
MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
[[ "${MODEL}" == *"Pi Zero"* ]] && ok "modello ${MODEL}" || warn "modello non riconosciuto come Pi Zero: ${MODEL:-n/d}"
modinfo mt7601u >/dev/null 2>&1 && ok "driver mt7601u disponibile" || fail "driver mt7601u non disponibile"
lsmod | grep -q '^mt7601u' && ok "driver mt7601u caricato" || warn "driver mt7601u non caricato/adattatore assente"
(command -v rpicam-still >/dev/null || command -v libcamera-still >/dev/null) && ok "stack camera disponibile" || fail "rpicam-still/libcamera-still assente"

if find /home/octoprint/.octoprint/plugins -mindepth 1 -type f -print -quit 2>/dev/null | grep -q .; then
  fail "plugin OctoPrint locali rilevati: il bridge richiede OctoPrint core senza plugin aggiuntivi"
else
  ok "nessun plugin OctoPrint locale aggiuntivo"
fi
if find /home/octoprint/.octoprint/scripts/gcode -mindepth 1 -type f -print -quit 2>/dev/null | grep -q .; then
  fail "script G-code OctoPrint rilevati: potrebbero modificare il flusso"
else
  ok "nessuno script G-code OctoPrint"
fi
systemctl is-active --quiet octoprint.service && ok "OctoPrint attivo" || fail "OctoPrint non attivo"
systemctl is-active --quiet affetta-octobridge.service && ok "OctoBridge attivo" || fail "OctoBridge non attivo"
OCTO_VERSION_JSON="$(curl -fsS http://127.0.0.1:5000/api/version 2>/dev/null || true)"
if [[ -n "${OCTO_VERSION_JSON}" ]]; then
  ok "API OctoPrint locale raggiungibile"
  OCTO_VERSION_JSON="${OCTO_VERSION_JSON}" python3 - <<'PYSAFEMODE' || FAIL=1
import json,os
d=json.loads(os.environ['OCTO_VERSION_JSON'])
assert d.get('safemode') is not False, 'OctoPrint non è avviato in safe mode'
print('[OK] OctoPrint safe mode permanente')
PYSAFEMODE
else
  fail "API OctoPrint non raggiungibile"
fi
curl -fsS http://127.0.0.1:8792/health | grep -q '"production_ready":false' && ok "health OctoBridge experimental/production_ready=false" || fail "health OctoBridge non conforme"
/opt/octoprint/venv/bin/python - <<'PYOCTOCONFIG' || FAIL=1
from pathlib import Path
import yaml
d=yaml.safe_load(Path('/home/octoprint/.octoprint/config.yaml').read_text(encoding='utf-8')) or {}
assert (d.get('webcam') or {}).get('timelapseEnabled') is False
assert ((d.get('webcam') or {}).get('timelapse') or {}).get('type') == 'off'
scripts=((d.get('scripts') or {}).get('gcode') or {})
for name in ('afterPrinterConnected','beforePrinterDisconnected','beforePrintStarted','afterPrintCancelled','afterPrintDone','beforePrintPaused','afterPrintResumed','beforeToolChange','afterToolChange'):
    assert scripts.get(name) is None, f'script G-code attivo: {name}'
print('[OK] timelapse OctoPrint disattivato e script G-code nulli')
PYOCTOCONFIG
python3 - <<'PYVALIDATE' || FAIL=1
import json
p='/etc/affetta-octobridge/config.json'
d=json.load(open(p,encoding='utf-8'))
assert d.get('release_channel')=='experimental'
assert d.get('production_ready') is False
assert d.get('verify_remote_sha256') is True
assert d.get('require_pre_print_snapshot') is True
print('[OK] vincoli configurazione preservati')
PYVALIDATE
vcgencmd get_throttled 2>/dev/null || warn "vcgencmd non disponibile"
exit "${FAIL}"
