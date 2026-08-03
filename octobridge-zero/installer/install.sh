#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="0.1.0-experimental+p4.4"
SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="UNCONFIGURED"
ENABLE_EXPERIMENTAL=0
FORCE_UNSUPPORTED=0
BUILD_SWAP_MB=1024
ALLOW_EXISTING_OCTOPRINT=0

usage(){
  cat <<EOF
Uso: sudo ./installer/install.sh [opzioni]
  --profile ID                    seleziona un profilo seriale candidato
  --enable-experimental-printing  abilita il gate per i collaudi fisici
  --build-swap-mb N               swap temporaneo durante pip (default 1024; 0 disabilita)
  --force-unsupported             consente installazione fuori dal Pi Zero/ARMv6
  --allow-existing-octoprint      consente solo una reinstallazione OctoBridge già marcata

La build resta sempre experimental e production_ready=false.
EOF
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --enable-experimental-printing) ENABLE_EXPERIMENTAL=1; shift;;
    --build-swap-mb) BUILD_SWAP_MB="$2"; shift 2;;
    --force-unsupported) FORCE_UNSUPPORTED=1; shift;;
    --allow-existing-octoprint) ALLOW_EXISTING_OCTOPRINT=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Argomento sconosciuto: $1" >&2; usage; exit 2;;
  esac
done

[[ ${EUID} -eq 0 ]] || { echo "Eseguire con sudo/root." >&2; exit 1; }
ARCH="$(uname -m)"
MODEL="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || true)"
if [[ ${FORCE_UNSUPPORTED} -ne 1 ]]; then
  [[ "${ARCH}" == "armv6l" ]] || { echo "Target atteso armv6l, trovato ${ARCH}. Usare --force-unsupported solo per test." >&2; exit 3; }
  [[ "${MODEL}" == *"Pi Zero"* ]] || { echo "Raspberry Pi Zero non rilevato: ${MODEL:-n/d}." >&2; exit 3; }
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  python3 python3-venv python3-dev python3-pip build-essential pkg-config git curl ca-certificates \
  libyaml-dev libffi-dev libssl-dev libjpeg-dev zlib1g-dev libopenjp2-7-dev \
  rustc cargo network-manager usbutils iw rfkill
apt-get install -y --no-install-recommends firmware-misc-nonfree || true
apt-get install -y --no-install-recommends rpicam-apps-lite || apt-get install -y --no-install-recommends rpicam-apps || true

PY_MINOR="$(python3 -c 'import sys; print(sys.version_info.major*100+sys.version_info.minor)')"
[[ ${PY_MINOR} -ge 310 ]] || { echo "Richiesto Python >=3.10, trovato $(python3 --version)." >&2; exit 4; }

id octoprint >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/octoprint --shell /usr/sbin/nologin octoprint
id octobridge >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/affetta-octobridge --shell /usr/sbin/nologin octobridge
usermod -a -G dialout octoprint
usermod -a -G video,render octobridge 2>/dev/null || usermod -a -G video octobridge

install -d -o root -g root -m 0755 /opt/affetta-octobridge /opt/octoprint
install -d -o octoprint -g octoprint -m 0750 /home/octoprint/.octoprint
install -d -o octobridge -g octobridge -m 0750 /var/lib/affetta-octobridge/jobs
install -d -o root -g octobridge -m 0750 /etc/affetta-octobridge

INSTALL_MARKER=/etc/affetta-octobridge/installed-by-affetta.json
if [[ -f /home/octoprint/.octoprint/config.yaml ]] && [[ ! -f "${INSTALL_MARKER}" ]]; then
  echo "È presente un'installazione OctoPrint non creata da Affetta OctoBridge." >&2
  echo "Per evitare plugin o script capaci di alterare il G-code, usare una Raspberry Pi OS Lite pulita." >&2
  exit 5
fi
if [[ -f /home/octoprint/.octoprint/config.yaml ]] && [[ ${ALLOW_EXISTING_OCTOPRINT} -ne 1 ]]; then
  echo "OctoBridge risulta già installato. Per una reinstallazione esplicita usare --allow-existing-octoprint." >&2
  exit 5
fi
if find /home/octoprint/.octoprint/plugins -mindepth 1 -type f -print -quit 2>/dev/null | grep -q .; then
  echo "Plugin OctoPrint locali rilevati: installazione rifiutata per preservare il G-code byte-per-byte." >&2
  exit 5
fi
if find /home/octoprint/.octoprint/scripts/gcode -mindepth 1 -type f -print -quit 2>/dev/null | grep -q .; then
  echo "Script G-code OctoPrint rilevati: installazione rifiutata perché potrebbero modificare il flusso." >&2
  exit 5
fi
rm -rf /opt/affetta-octobridge/affetta_octobridge /opt/affetta-octobridge/config /opt/affetta-octobridge/scripts
cp -a "${SOURCE_ROOT}/affetta_octobridge" "${SOURCE_ROOT}/config" "${SOURCE_ROOT}/scripts" /opt/affetta-octobridge/
cp "${SOURCE_ROOT}/VERSION" "${SOURCE_ROOT}/STATUS.json" /opt/affetta-octobridge/
chown -R root:root /opt/affetta-octobridge
find /opt/affetta-octobridge -type d -exec chmod 0755 {} +
find /opt/affetta-octobridge -type f -exec chmod 0644 {} +
chmod 0755 /opt/affetta-octobridge/scripts/*.sh /opt/affetta-octobridge/scripts/*.py

SWAPFILE=/var/swap.affetta-octobridge-build
cleanup_swap(){
  if swapon --show=NAME --noheadings 2>/dev/null | grep -qx "${SWAPFILE}"; then swapoff "${SWAPFILE}" || true; fi
  rm -f "${SWAPFILE}" || true
}
trap cleanup_swap EXIT
if [[ ${BUILD_SWAP_MB} -gt 0 ]] && [[ "$(free -m | awk '/^Mem:/ {print $2}')" -lt 700 ]]; then
  echo "Creo swap temporaneo da ${BUILD_SWAP_MB} MiB solo per l'installazione Python..."
  fallocate -l "${BUILD_SWAP_MB}M" "${SWAPFILE}" 2>/dev/null || dd if=/dev/zero of="${SWAPFILE}" bs=1M count="${BUILD_SWAP_MB}" status=progress
  chmod 600 "${SWAPFILE}"
  mkswap "${SWAPFILE}" >/dev/null
  swapon "${SWAPFILE}"
fi

if [[ ! -x /opt/octoprint/venv/bin/python ]]; then
  python3 -m venv /opt/octoprint/venv
fi
/opt/octoprint/venv/bin/pip install --upgrade pip setuptools wheel
/opt/octoprint/venv/bin/pip install --no-cache-dir -r "${SOURCE_ROOT}/requirements-octoprint.txt"
/opt/octoprint/venv/bin/octoprint --version
/opt/octoprint/venv/bin/pip freeze > /opt/octoprint/installed-requirements.txt
chown -R root:root /opt/octoprint/venv /opt/octoprint/installed-requirements.txt

OCTO_KEY="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
BRIDGE_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
if [[ ! -f /home/octoprint/.octoprint/config.yaml ]]; then
  cat >/home/octoprint/.octoprint/config.yaml <<EOF
accessControl:
  enabled: false
api:
  key: "${OCTO_KEY}"
server:
  firstRun: false
  host: 127.0.0.1
  port: 5000
  onlineCheck:
    enabled: false
  pluginBlacklist:
    enabled: false
serial:
  autoconnect: false
  log: false
webcam:
  webcamEnabled: false
  timelapseEnabled: false
  timelapse:
    type: "off"
scripts:
  gcode:
    afterPrinterConnected: null
    beforePrinterDisconnected: null
    beforePrintStarted: null
    afterPrintCancelled: null
    afterPrintDone: null
    beforePrintPaused: null
    afterPrintResumed: null
    beforeToolChange: null
    afterToolChange: null
plugins:
  disabled:
    - announcements
    - appkeys
    - backup
    - discovery
    - errortracking
    - eventmanager
    - gcodeviewer
    - pluginmanager
    - softwareupdate
    - tracking
  tracking:
    enabled: false
  softwareupdate:
    checks: {}
EOF
  chmod 600 /home/octoprint/.octoprint/config.yaml
  chown octoprint:octoprint /home/octoprint/.octoprint/config.yaml
else
  OCTO_KEY="$(/opt/octoprint/venv/bin/python - <<'PYOCTOKEY'
from pathlib import Path
import yaml
data = yaml.safe_load(Path('/home/octoprint/.octoprint/config.yaml').read_text(encoding='utf-8')) or {}
print(str((data.get('api') or {}).get('key') or ''))
PYOCTOKEY
)"
  [[ -n "${OCTO_KEY}" ]] || { echo "Impossibile ricavare la chiave API OctoPrint esistente." >&2; exit 5; }
fi

# Impone ad ogni installazione i vincoli zero-plugin/zero-script/zero-timelapse.
/opt/octoprint/venv/bin/python - <<'PYOCTOENFORCE'
from pathlib import Path
import yaml
p = Path('/home/octoprint/.octoprint/config.yaml')
data = yaml.safe_load(p.read_text(encoding='utf-8')) or {}
data.setdefault('accessControl', {})['enabled'] = False
data.setdefault('server', {})['firstRun'] = False
data['server']['host'] = '127.0.0.1'
data['server']['port'] = 5000
data['server'].setdefault('onlineCheck', {})['enabled'] = False
data['server'].setdefault('pluginBlacklist', {})['enabled'] = False
data.setdefault('serial', {})['autoconnect'] = False
data['serial']['log'] = False
webcam = data.setdefault('webcam', {})
webcam['webcamEnabled'] = False
webcam['timelapseEnabled'] = False
webcam.setdefault('timelapse', {})['type'] = 'off'
scripts = data.setdefault('scripts', {}).setdefault('gcode', {})
for name in (
    'afterPrinterConnected', 'beforePrinterDisconnected', 'beforePrintStarted',
    'afterPrintCancelled', 'afterPrintDone', 'beforePrintPaused',
    'afterPrintResumed', 'beforeToolChange', 'afterToolChange',
):
    scripts[name] = None
plugins = data.setdefault('plugins', {})
disabled = set(plugins.get('disabled') or [])
disabled.update({
    'announcements', 'appkeys', 'backup', 'discovery', 'errortracking',
    'eventmanager', 'gcodeviewer', 'pluginmanager', 'softwareupdate', 'tracking',
})
plugins['disabled'] = sorted(disabled)
plugins.setdefault('tracking', {})['enabled'] = False
plugins.setdefault('softwareupdate', {})['checks'] = {}
p.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding='utf-8')
PYOCTOENFORCE
chmod 600 /home/octoprint/.octoprint/config.yaml
chown octoprint:octoprint /home/octoprint/.octoprint/config.yaml

if [[ ! -f /etc/affetta-octobridge/config.json ]]; then
  python3 - "${SOURCE_ROOT}/config/octobridge.example.json" "${BRIDGE_TOKEN}" "${OCTO_KEY}" <<'PYCONFIG'
import json,sys
from pathlib import Path
src,token,key=sys.argv[1:]
d=json.loads(Path(src).read_text())
d['api_token']=token
d['octoprint_api_key']=key
d['release_channel']='experimental'
d['production_ready']=False
Path('/etc/affetta-octobridge/config.json').write_text(json.dumps(d,indent=2,ensure_ascii=False)+'\n')
PYCONFIG
  chmod 600 /etc/affetta-octobridge/config.json
  chown root:octobridge /etc/affetta-octobridge/config.json
fi
python3 - "${INSTALL_MARKER}" "${VERSION}" <<'PYMARKER'
import json,sys
from datetime import datetime,timezone
from pathlib import Path
path,version=sys.argv[1:]
Path(path).write_text(json.dumps({
    'schema_version':'affetta.octobridge-install-marker.v1',
    'version':version,
    'release_channel':'experimental',
    'production_ready':False,
    'updated_at':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),
},indent=2)+'\n',encoding='utf-8')
PYMARKER
chmod 0640 "${INSTALL_MARKER}"
chown root:octobridge "${INSTALL_MARKER}"

install -m 0644 "${SOURCE_ROOT}/systemd/octoprint.service" /etc/systemd/system/octoprint.service
install -m 0644 "${SOURCE_ROOT}/systemd/affetta-octobridge.service" /etc/systemd/system/affetta-octobridge.service
systemctl daemon-reload
systemctl enable octoprint.service affetta-octobridge.service
systemctl restart octoprint.service
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:5000/api/version >/dev/null 2>&1 && break; sleep 2; done
systemctl restart affetta-octobridge.service

modprobe mt7601u || true
if [[ "${PROFILE}" != "UNCONFIGURED" ]]; then
  ARGS=(--profile "${PROFILE}")
  [[ ${ENABLE_EXPERIMENTAL} -eq 1 ]] && ARGS+=(--enable-experimental-printing)
  python3 /opt/affetta-octobridge/scripts/configure.py "${ARGS[@]}" --restart
fi

cleanup_swap
trap - EXIT
cat <<EOF

=== AFFETTA OCTOBRIDGE ZERO SNAPSHOT INSTALLATO ===
Versione: ${VERSION}
Stato: experimental
production_ready: false
OctoPrint: http://127.0.0.1:5000 (solo localhost)
OctoBridge: porta LAN 8792
Profilo: ${PROFILE}

Il token API è conservato in /etc/affetta-octobridge/config.json e non viene stampato.
Eseguire: sudo /opt/affetta-octobridge/scripts/validate.sh
EOF
