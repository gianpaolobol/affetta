#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

main() {
    local explicit="${1:-}"
    local -a candidates=()
    local device resolved

    if [[ -n "${explicit}" && "${explicit}" != "AUTO" ]]; then
        resolved="$(readlink -f -- "${explicit}" 2>/dev/null || true)"
        [[ -n "${resolved}" && -c "${resolved}" ]] || {
            printf 'Porta seriale non valida: %s\n' "${explicit}" >&2
            return 2
        }
        printf '%s\n' "${explicit}"
        return 0
    fi

    shopt -s nullglob

    for device in /dev/serial/by-id/*; do
        resolved="$(readlink -f -- "${device}" 2>/dev/null || true)"
        [[ -n "${resolved}" && -c "${resolved}" ]] && candidates+=("${device}")
    done

    if (( ${#candidates[@]} == 0 )); then
        for device in /dev/serial/by-path/*; do
            resolved="$(readlink -f -- "${device}" 2>/dev/null || true)"
            [[ -n "${resolved}" && -c "${resolved}" ]] && candidates+=("${device}")
        done
    fi

    if (( ${#candidates[@]} == 0 )); then
        for device in /dev/ttyACM* /dev/ttyUSB*; do
            [[ -c "${device}" ]] && candidates+=("${device}")
        done
    fi

    case "${#candidates[@]}" in
        0)
            printf '%s\n' "AUTO"
            ;;
        1)
            printf '%s\n' "${candidates[0]}"
            ;;
        *)
            printf 'Più porte seriali rilevate. Specificare --serial-port:\n' >&2
            printf '  %s\n' "${candidates[@]}" >&2
            return 3
            ;;
    esac
}

main "$@"
