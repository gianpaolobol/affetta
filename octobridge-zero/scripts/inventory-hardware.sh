#!/usr/bin/env bash
set -u

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${1:-$HOME/affetta-raspberry-inventory-${STAMP}.txt}"

section() {
  printf '\n===== %s =====\n' "$1"
}

run_safe() {
  "$@" 2>&1 || true
}

{
  echo "AFFETTA RASPBERRY HARDWARE INVENTORY"
  echo "generated_at=$(date --iso-8601=seconds 2>/dev/null || date)"
  echo "hostname=$(hostname 2>/dev/null || true)"

  section "MODELLO E REVISIONE"
  if [[ -r /proc/device-tree/model ]]; then tr -d '\0' </proc/device-tree/model; echo; fi
  if [[ -r /proc/cpuinfo ]]; then
    grep -E '^(Hardware|Revision|Model|Serial)' /proc/cpuinfo || true
  fi
  run_safe uname -a
  run_safe dpkg --print-architecture
  run_safe getconf LONG_BIT

  section "SISTEMA OPERATIVO"
  [[ -r /etc/os-release ]] && cat /etc/os-release
  run_safe python3 --version
  run_safe systemd --version

  section "CPU E MEMORIA"
  run_safe lscpu
  run_safe free -h
  run_safe vcgencmd measure_temp
  run_safe vcgencmd get_throttled

  section "STORAGE"
  run_safe lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL
  run_safe df -hT

  section "USB"
  run_safe lsusb
  run_safe lsusb -t

  section "RETE"
  run_safe ip -brief link
  run_safe ip -brief address
  run_safe iw dev
  run_safe rfkill list
  run_safe nmcli -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.CONNECTION device show

  section "MT7601U"
  run_safe modinfo mt7601u
  run_safe lsmod
  dmesg 2>/dev/null | grep -Ei 'mt7601|firmware|usb.*disconnect|under.?voltage' | tail -n 200 || true

  section "CAMERA CSI"
  if command -v rpicam-hello >/dev/null 2>&1; then
    run_safe rpicam-hello --list-cameras
  elif command -v libcamera-hello >/dev/null 2>&1; then
    run_safe libcamera-hello --list-cameras
  else
    echo "rpicam-hello/libcamera-hello non installato"
  fi
  run_safe ls -l /dev/video0 /dev/media0 /dev/media1
  run_safe groups

  section "SERIALE STAMPANTE"
  run_safe ls -la /dev/serial/by-id
  run_safe ls -la /dev/ttyUSB0 /dev/ttyACM0
  dmesg 2>/dev/null | grep -Ei 'tty(USB|ACM)|cdc_acm|ch34|ftdi' | tail -n 100 || true

  section "SERVIZI AFFETTA"
  run_safe systemctl --no-pager --full status octoprint.service
  run_safe systemctl --no-pager --full status affetta-octobridge.service

  section "VERSIONI OCTOBRIDGE"
  [[ -r /opt/affetta-octobridge/VERSION ]] && cat /opt/affetta-octobridge/VERSION
  [[ -r /opt/affetta-octobridge/STATUS.json ]] && cat /opt/affetta-octobridge/STATUS.json
  [[ -x /opt/octoprint/venv/bin/octoprint ]] && run_safe /opt/octoprint/venv/bin/octoprint --version

  section "NOTA PRIVACY"
  echo "Il report non include password Wi-Fi, token API o contenuto dei file G-code."
} | tee "$OUT"

echo
echo "Report salvato in: $OUT"
