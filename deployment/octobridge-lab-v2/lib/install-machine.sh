#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly PACKAGE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

MANIFEST=""
AFFETTA_SOURCE=""
AFFETTA_REF="${AFFETTA_REF:-main}"
SERIAL_PORT_REQUESTED="${SERIAL_PORT:-AUTO}"
OCTOPRINT_URL="${OCTOPRINT_URL:-http://127.0.0.1:5000}"
OCTOPRINT_SERVICE="${OCTOPRINT_SERVICE:-octoprint.service}"
ENABLE_EXPERIMENTAL_PRINTING=0
ROTATE_TOKEN=0
NO_START=0

BRIDGE_ROOT="/opt/affetta-octobridge"
CONFIG_DIR="/etc/affetta-octobridge"
DATA_DIR="/var/lib/affetta-octobridge"
SOURCE_CACHE="/opt/affetta-source"
SERVICE_USER="octobridge"
SERVICE_GROUP="octobridge"
SERVICE_FILE="/etc/systemd/system/affetta-octobridge.service"

log()  { printf '[INFO] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
die()  { printf '[ERRORE] %s\n' "$*" >&2; exit 1; }

on_error() {
    local rc=$?
    printf '[ERRORE] riga %s: %s (exit %s)\n' "${BASH_LINENO[0]:-?}" "${BASH_COMMAND:-?}" "${rc}" >&2
    exit "${rc}"
}
trap on_error ERR

usage() {
    cat <<'EOF'
Uso:
  sudo bash install-machine.sh --manifest FILE [opzioni]

Opzioni:
  --affetta-source DIR              clone/cartella Affetta già disponibile
  --affetta-ref REF                 branch/tag/commit da usare se si clona
  --serial-port AUTO|/dev/...       porta esplicita o rilevamento sicuro
  --octoprint-url URL               predefinito http://127.0.0.1:5000
  --octoprint-service NAME          predefinito octoprint.service
  --enable-experimental-printing    abilita start seriale, senza production_ready
  --rotate-token                    genera un nuovo token bridge
  --no-start                        installa e abilita senza avviare il servizio
EOF
}

while (( $# )); do
    case "$1" in
        --manifest)
            [[ $# -ge 2 ]] || die "--manifest richiede un valore"
            MANIFEST="$2"; shift 2 ;;
        --affetta-source)
            [[ $# -ge 2 ]] || die "--affetta-source richiede un valore"
            AFFETTA_SOURCE="$2"; shift 2 ;;
        --affetta-ref)
            [[ $# -ge 2 ]] || die "--affetta-ref richiede un valore"
            AFFETTA_REF="$2"; shift 2 ;;
        --serial-port)
            [[ $# -ge 2 ]] || die "--serial-port richiede un valore"
            SERIAL_PORT_REQUESTED="$2"; shift 2 ;;
        --octoprint-url)
            [[ $# -ge 2 ]] || die "--octoprint-url richiede un valore"
            OCTOPRINT_URL="$2"; shift 2 ;;
        --octoprint-service)
            [[ $# -ge 2 ]] || die "--octoprint-service richiede un valore"
            OCTOPRINT_SERVICE="$2"; shift 2 ;;
        --enable-experimental-printing)
            ENABLE_EXPERIMENTAL_PRINTING=1; shift ;;
        --rotate-token)
            ROTATE_TOKEN=1; shift ;;
        --no-start)
            NO_START=1; shift ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            die "Argomento sconosciuto: $1" ;;
    esac
done

[[ "${EUID}" -eq 0 ]] || die "Eseguire con sudo."
[[ -n "${MANIFEST}" ]] || die "--manifest è obbligatorio."
[[ -f "${MANIFEST}" ]] || die "Manifest non trovato: ${MANIFEST}"
command -v systemctl >/dev/null 2>&1 || die "systemd non disponibile."
command -v python3 >/dev/null 2>&1 || die "Python 3 non disponibile."

PYTHON_VERSION="$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')"
python3 - <<'PY'
import sys
if sys.version_info < (3, 7):
    raise SystemExit("Python 3.7 o successivo richiesto.")
PY
log "Python ${PYTHON_VERSION} rilevato."

if command -v apt-get >/dev/null 2>&1; then
    log "Installazione prerequisiti minimi..."
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        git ca-certificates curl avahi-daemon
else
    warn "apt-get non presente; si assume che git, curl e Avahi siano già disponibili."
fi

read_manifest() {
    python3 - "$MANIFEST" "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
value = doc.get(sys.argv[2])
if value is None:
    raise SystemExit("Campo manifest mancante: " + sys.argv[2])
print(value)
PY
}

FLEET_UNIT_ID="$(read_manifest fleet_unit_id)"
DISPLAY_NAME="$(read_manifest display_name)"
BRIDGE_ID="$(read_manifest bridge_id)"
HOSTNAME_NEW="$(read_manifest hostname)"
PROFILE_ID="$(read_manifest printer_profile_id)"

[[ "${FLEET_UNIT_ID}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || die "fleet_unit_id non valido."
[[ "${BRIDGE_ID}" =~ ^[a-z0-9][a-z0-9-]{1,95}$ ]] || die "bridge_id non valido."
[[ "${HOSTNAME_NEW}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || die "hostname non valido."
[[ "${PROFILE_ID}" =~ ^[a-z0-9][a-z0-9-]{1,95}$ ]] || die "printer_profile_id non valido."

log "Unità: ${DISPLAY_NAME} (${FLEET_UNIT_ID})"
log "Bridge: ${BRIDGE_ID}"
log "Hostname: ${HOSTNAME_NEW}"

if [[ -z "${AFFETTA_SOURCE}" ]]; then
    if [[ -d "${SOURCE_CACHE}/.git" ]]; then
        log "Aggiornamento sorgente Affetta locale..."
        git -C "${SOURCE_CACHE}" fetch --tags --prune origin
    else
        log "Clone sorgente Affetta..."
        rm -rf -- "${SOURCE_CACHE}"
        git clone --filter=blob:none --no-checkout \
            https://github.com/gianpaolobol/affetta.git "${SOURCE_CACHE}"
    fi
    git -C "${SOURCE_CACHE}" checkout --force "${AFFETTA_REF}"
    AFFETTA_SOURCE="${SOURCE_CACHE}"
fi

[[ -d "${AFFETTA_SOURCE}/octobridge-zero/affetta_octobridge" ]] ||
    die "Sorgente OctoBridge non trovato in ${AFFETTA_SOURCE}"

SOURCE_COMMIT="$(
    git -C "${AFFETTA_SOURCE}" rev-parse HEAD 2>/dev/null ||
    printf 'source-not-a-git-repository'
)"
log "Sorgente Affetta: ${SOURCE_COMMIT}"

if ! getent group "${SERVICE_GROUP}" >/dev/null; then
    groupadd --system "${SERVICE_GROUP}"
fi
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --gid "${SERVICE_GROUP}" --home-dir "${DATA_DIR}" \
        --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
SUPPLEMENTARY_GROUPS=()
for group in dialout video; do
    if getent group "${group}" >/dev/null; then
        usermod -aG "${group}" "${SERVICE_USER}"
        SUPPLEMENTARY_GROUPS+=("${group}")
    fi
done
SUPPLEMENTARY_GROUPS_LINE=""
if (( ${#SUPPLEMENTARY_GROUPS[@]} > 0 )); then
    SUPPLEMENTARY_GROUPS_LINE="SupplementaryGroups=${SUPPLEMENTARY_GROUPS[*]}"
fi

install -d -o root -g root -m 0755 "${BRIDGE_ROOT}"
install -d -o root -g root -m 0755 "${BRIDGE_ROOT}/config"
install -d -o root -g root -m 0755 "${BRIDGE_ROOT}/scripts"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${CONFIG_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${DATA_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" -m 0750 "${DATA_DIR}/jobs"
install -d -o root -g "${SERVICE_GROUP}" -m 0750 "${DATA_DIR}/registration"

rm -rf -- "${BRIDGE_ROOT}/affetta_octobridge"
cp -a -- "${AFFETTA_SOURCE}/octobridge-zero/affetta_octobridge" "${BRIDGE_ROOT}/"
cp -- "${AFFETTA_SOURCE}/octobridge-zero/config/octobridge.example.json" \
    "${BRIDGE_ROOT}/config/octobridge.example.json"
cp -- "${SCRIPT_DIR}/configure_instance.py" "${BRIDGE_ROOT}/scripts/"
cp -- "${SCRIPT_DIR}/validate_config.py" "${BRIDGE_ROOT}/scripts/"
cp -- "${SCRIPT_DIR}/check_octoprint.py" "${BRIDGE_ROOT}/scripts/"
cp -- "${MANIFEST}" "${BRIDGE_ROOT}/config/machine.json"
printf '%s\n' "${SOURCE_COMMIT}" > "${BRIDGE_ROOT}/AFFETTA_SOURCE_COMMIT"

find "${BRIDGE_ROOT}" -type d -exec chmod 0755 {} +
find "${BRIDGE_ROOT}" -type f -exec chmod 0644 {} +
chmod 0755 "${BRIDGE_ROOT}/scripts/"*.py

if systemctl list-unit-files --type=service 2>/dev/null | awk '{print $1}' | grep -Fxq "${OCTOPRINT_SERVICE}"; then
    log "Servizio OctoPrint rilevato: ${OCTOPRINT_SERVICE}"
else
    warn "Servizio ${OCTOPRINT_SERVICE} non trovato. Il bridge sarà installato ma non potrà leggere la stampante finché OctoPrint non sarà disponibile."
fi

SECRET_FILE="$(mktemp)"
trap 'rm -f -- "${SECRET_FILE}"' EXIT
chmod 0600 "${SECRET_FILE}"

if [[ -t 0 ]]; then
    read -rsp "API key OctoPrint: " OCTOPRINT_API_KEY
    printf '\n'
else
    die "Installazione non interattiva: fornire una TTY per inserire la API key."
fi
[[ ${#OCTOPRINT_API_KEY} -ge 10 ]] || die "API key OctoPrint troppo corta."
printf '%s\n' "${OCTOPRINT_API_KEY}" > "${SECRET_FILE}"
unset OCTOPRINT_API_KEY

if systemctl is-active --quiet "${OCTOPRINT_SERVICE}" 2>/dev/null; then
    python3 "${SCRIPT_DIR}/check_octoprint.py" \
        --url "${OCTOPRINT_URL}" \
        --api-key-file "${SECRET_FILE}"
else
    warn "OctoPrint non attivo: verifica API rinviata."
fi

SERIAL_PORT="$("${SCRIPT_DIR}/detect_serial.sh" "${SERIAL_PORT_REQUESTED}")"
log "Porta seriale configurata: ${SERIAL_PORT}"

hostnamectl set-hostname "${HOSTNAME_NEW}"
if grep -Eq '^127[.]0[.]1[.]1[[:space:]]+' /etc/hosts; then
    sed -Ei "s/^127[.]0[.]1[.]1[[:space:]]+.*/127.0.1.1\t${HOSTNAME_NEW}/" /etc/hosts
else
    printf '127.0.1.1\t%s\n' "${HOSTNAME_NEW}" >> /etc/hosts
fi
systemctl enable avahi-daemon.service >/dev/null 2>&1 || true
systemctl restart avahi-daemon.service >/dev/null 2>&1 || true

CONFIG_ARGS=(
    --machine "${MANIFEST}"
    --base-config "${BRIDGE_ROOT}/config/octobridge.example.json"
    --config-out "${CONFIG_DIR}/config.json"
    --catalog-out "${BRIDGE_ROOT}/config/printer-catalog.json"
    --registration-out "${DATA_DIR}/registration/server-lite-registration.json"
    --serial-port "${SERIAL_PORT}"
    --octoprint-url "${OCTOPRINT_URL}"
    --octoprint-api-key-file "${SECRET_FILE}"
    --endpoint-host "${HOSTNAME_NEW}.local"
)
(( ENABLE_EXPERIMENTAL_PRINTING )) && CONFIG_ARGS+=(--enable-experimental-printing)
(( ROTATE_TOKEN )) && CONFIG_ARGS+=(--rotate-bridge-token)

python3 "${SCRIPT_DIR}/configure_instance.py" "${CONFIG_ARGS[@]}"

chown root:"${SERVICE_GROUP}" "${CONFIG_DIR}/config.json"
chmod 0640 "${CONFIG_DIR}/config.json"
chown root:root "${BRIDGE_ROOT}/config/printer-catalog.json"
chmod 0644 "${BRIDGE_ROOT}/config/printer-catalog.json"
chown root:"${SERVICE_GROUP}" "${DATA_DIR}/registration/server-lite-registration.json"
chmod 0640 "${DATA_DIR}/registration/server-lite-registration.json"

python3 "${SCRIPT_DIR}/validate_config.py" \
    --config "${CONFIG_DIR}/config.json" \
    --catalog "${BRIDGE_ROOT}/config/printer-catalog.json"

python3 -m compileall -q "${BRIDGE_ROOT}/affetta_octobridge"

MEM_KB="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
if (( MEM_KB < 400000 )); then
    MEMORY_HIGH="64M"
    MEMORY_MAX="96M"
elif (( MEM_KB < 800000 )); then
    MEMORY_HIGH="96M"
    MEMORY_MAX="160M"
else
    MEMORY_HIGH="128M"
    MEMORY_MAX="224M"
fi

cat > "${SERVICE_FILE}" <<EOF
[Unit]
Description=Affetta OctoBridge — ${DISPLAY_NAME}
Documentation=https://github.com/gianpaolobol/affetta
After=network.target ${OCTOPRINT_SERVICE}
Wants=${OCTOPRINT_SERVICE}
StartLimitIntervalSec=120
StartLimitBurst=5
ConditionPathExists=${CONFIG_DIR}/config.json
ConditionPathExists=${BRIDGE_ROOT}/config/printer-catalog.json

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
${SUPPLEMENTARY_GROUPS_LINE}
WorkingDirectory=${BRIDGE_ROOT}
Environment=PYTHONPATH=${BRIDGE_ROOT}
Environment=PYTHONUNBUFFERED=1
Environment=AFFETTA_OCTOBRIDGE_CONFIG=${CONFIG_DIR}/config.json
ExecStartPre=/usr/bin/python3 ${BRIDGE_ROOT}/scripts/validate_config.py --config ${CONFIG_DIR}/config.json --catalog ${BRIDGE_ROOT}/config/printer-catalog.json
ExecStart=/usr/bin/python3 -m affetta_octobridge
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
StandardOutput=journal
StandardError=journal
SyslogIdentifier=affetta-octobridge-${FLEET_UNIT_ID}

MemoryAccounting=true
MemoryHigh=${MEMORY_HIGH}
MemoryMax=${MEMORY_MAX}
CPUAccounting=true
CPUQuota=80%
TasksMax=64

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=${CONFIG_DIR} ${BRIDGE_ROOT}
ReadWritePaths=${DATA_DIR} /run
UMask=0077

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable affetta-octobridge.service >/dev/null

if command -v systemd-analyze >/dev/null 2>&1; then
    if systemctl list-unit-files --type=service 2>/dev/null | awk '{print $1}' | grep -Fxq "${OCTOPRINT_SERVICE}"; then
        systemd-analyze verify "${SERVICE_FILE}"
    else
        systemd-analyze verify "${SERVICE_FILE}" || warn "Verifica systemd incompleta perché ${OCTOPRINT_SERVICE} non è ancora installato."
    fi
fi

if (( NO_START )); then
    warn "Servizio non avviato per richiesta --no-start."
else
    systemctl restart affetta-octobridge.service
    sleep 2
    if ! systemctl is-active --quiet affetta-octobridge.service; then
        journalctl -u affetta-octobridge.service -n 80 --no-pager >&2 || true
        die "OctoBridge non si è avviato."
    fi
    curl --fail --silent --show-error "http://127.0.0.1:8792/health" >/dev/null
    log "Health check OctoBridge superato."
fi

cat <<EOF

Installazione completata.

Macchina:      ${DISPLAY_NAME}
Fleet ID:      ${FLEET_UNIT_ID}
Bridge ID:     ${BRIDGE_ID}
Hostname:      ${HOSTNAME_NEW}
Endpoint LAN:  http://${HOSTNAME_NEW}.local:8792
Seriale:       ${SERIAL_PORT}
Config:        ${CONFIG_DIR}/config.json
Registrazione: ${DATA_DIR}/registration/server-lite-registration.json

Comunicazione bidirezionale:
  Affetta -> bridge: upload, transfer, start, pause, resume, cancel
  bridge -> Affetta: status, eventi, snapshot e pending-sync letti dal Server Lite

Per esportare la registrazione sul tuo utente:
  sudo ${PACKAGE_ROOT}/lib/export-registration.sh

Stato di sicurezza:
  release_channel=experimental
  production_ready=false
  serial_printing_enabled=$([[ ${ENABLE_EXPERIMENTAL_PRINTING} -eq 1 ]] && echo true || echo false)
EOF
