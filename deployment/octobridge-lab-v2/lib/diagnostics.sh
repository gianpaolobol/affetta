#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

OUT="${1:-$HOME/affetta-octobridge-diagnostics-$(date +%Y%m%d-%H%M%S).txt}"

{
    echo "=== Affetta OctoBridge diagnostics ==="
    date --iso-8601=seconds 2>/dev/null || date
    echo
    echo "--- Hardware ---"
    cat /sys/firmware/devicetree/base/model 2>/dev/null || true
    uname -a
    grep -E '^(Model|Revision|Hardware|Serial)' /proc/cpuinfo 2>/dev/null || true
    grep MemTotal /proc/meminfo 2>/dev/null || true
    echo
    echo "--- USB e seriale ---"
    lsusb 2>/dev/null || true
    find -L /dev/serial -maxdepth 2 -type l -printf '%p -> %l\n' 2>/dev/null || true
    ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || true
    echo
    echo "--- Rete ---"
    ip -brief link 2>/dev/null || true
    ip -brief address 2>/dev/null || true
    echo
    echo "--- Servizi ---"
    systemctl --no-pager --full status octoprint.service 2>&1 || true
    systemctl --no-pager --full status affetta-octobridge.service 2>&1 || true
    echo
    echo "--- Journal bridge ---"
    journalctl -u affetta-octobridge.service -n 150 --no-pager 2>&1 || true
    echo
    echo "--- Config redatta ---"
    python3 - <<'PY' 2>&1 || true
import json
path = "/etc/affetta-octobridge/config.json"
with open(path, encoding="utf-8") as handle:
    cfg = json.load(handle)
for key in ("api_token", "octoprint_api_key"):
    if key in cfg:
        cfg[key] = "***REDACTED***"
print(json.dumps(cfg, ensure_ascii=False, indent=2))
PY
} > "${OUT}"

chmod 0600 "${OUT}"
printf 'Diagnostica creata: %s\n' "${OUT}"
