#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Eseguire con sudo." >&2
  exit 1
fi

SSID="${1:-}"
if [[ -z "${SSID}" ]]; then
  read -r -p "SSID Wi-Fi: " SSID
fi
read -r -s -p "Password Wi-Fi: " PASSWORD
echo

if ! command -v nmcli >/dev/null 2>&1; then
  echo "NetworkManager/nmcli non disponibile. Configurare il Wi-Fi con raspi-config." >&2
  exit 2
fi

modprobe mt7601u || true
ADAPTER="$(nmcli -t -f DEVICE,TYPE device status | awk -F: '$2=="wifi" {print $1; exit}')"
if [[ -z "${ADAPTER}" ]]; then
  echo "Nessun adattatore Wi-Fi rilevato. Controllare MT7601U, hub USB e alimentazione." >&2
  exit 3
fi

nmcli device wifi rescan ifname "${ADAPTER}" || true
nmcli --wait 30 device wifi connect "${SSID}" password "${PASSWORD}" ifname "${ADAPTER}"
printf 'Wi-Fi configurato su %s. IP: %s\n' "${ADAPTER}" "$(hostname -I | xargs)"
unset PASSWORD
