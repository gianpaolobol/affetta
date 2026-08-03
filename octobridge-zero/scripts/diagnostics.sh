#!/usr/bin/env bash
set -u
OUT="${1:-/tmp/affetta-octobridge-diagnostics-$(date +%Y%m%d-%H%M%S).txt}"
{
  echo "AFFETTA OCTOBRIDGE ZERO SNAPSHOT - DIAGNOSTICA"
  echo "data=$(date --iso-8601=seconds)"
  echo "release_channel=experimental"
  echo "production_ready=false"
  echo
  echo "== Sistema =="
  uname -a
  cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || true
  echo
  cat /etc/os-release 2>/dev/null || true
  echo
  echo "== Memoria e disco =="
  free -h || true
  df -h / /var/lib/affetta-octobridge 2>/dev/null || true
  echo
  echo "== Sottotensione/throttling =="
  vcgencmd get_throttled 2>/dev/null || echo "vcgencmd non disponibile"
  echo
  echo "== USB / MT7601U =="
  lsusb 2>/dev/null || true
  lsmod | grep -E 'mt7601u|mac80211|cfg80211' || true
  dmesg | grep -Ei 'mt7601|under.?voltage|usb disconnect' | tail -n 100 || true
  echo
  echo "== Rete =="
  ip -brief address || true
  iw dev 2>/dev/null || true
  echo
  echo "== Seriali =="
  ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true
  echo
  echo "== Camera =="
  command -v rpicam-still || command -v libcamera-still || true
  rpicam-hello --list-cameras 2>/dev/null || libcamera-hello --list-cameras 2>/dev/null || true
  echo
  echo "== Servizi =="
  systemctl --no-pager --full status octoprint.service affetta-octobridge.service 2>&1 || true
  echo
  echo "== Log recenti =="
  journalctl -u octoprint.service -u affetta-octobridge.service -n 200 --no-pager 2>&1 || true
  echo
  echo "== Configurazione redatta =="
  python3 - <<'PYDIAG' 2>/dev/null || true
import json
from pathlib import Path
p=Path('/etc/affetta-octobridge/config.json')
if p.exists():
    d=json.loads(p.read_text())
    for key in ('api_token','octoprint_api_key'):
        if key in d: d[key]='***REDACTED***'
    print(json.dumps(d,indent=2,ensure_ascii=False))
PYDIAG
} >"${OUT}" 2>&1
chmod 600 "${OUT}" 2>/dev/null || true
echo "Diagnostica salvata in ${OUT}"
