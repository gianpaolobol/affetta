#!/usr/bin/env bash
set -Eeuo pipefail
PURGE=0
[[ "${1:-}" == "--purge-data" ]] && PURGE=1
[[ ${EUID} -eq 0 ]] || { echo "Eseguire con sudo/root." >&2; exit 1; }
systemctl disable --now affetta-octobridge.service octoprint.service 2>/dev/null || true
rm -f /etc/systemd/system/affetta-octobridge.service /etc/systemd/system/octoprint.service
systemctl daemon-reload
rm -rf /opt/affetta-octobridge /opt/octoprint
if [[ ${PURGE} -eq 1 ]]; then
  rm -rf /etc/affetta-octobridge /var/lib/affetta-octobridge /home/octoprint/.octoprint
  userdel octobridge 2>/dev/null || true
  userdel octoprint 2>/dev/null || true
  echo "Rimozione completa inclusi dati e configurazioni."
else
  echo "Software rimosso. Dati e configurazioni conservati; usare --purge-data per eliminarli."
fi
