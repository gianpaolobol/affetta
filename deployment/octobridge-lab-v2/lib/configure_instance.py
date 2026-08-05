#!/usr/bin/env python3
"""Configura un'istanza Affetta OctoBridge in modo atomico.

Compatibilità intenzionale: Python 3.7+.
Nessun valore proveniente dalla shell viene interpolato in codice Python.
"""

from __future__ import print_function

import argparse
import getpass
import json
import os
import re
import secrets
import socket
import sys
import tempfile
from pathlib import Path


def read_json(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("Il file JSON deve contenere un oggetto.")
    return value


def atomic_json(path, value, mode=0o640):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, str(path))
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def read_secret_file(path):
    if not path:
        return None
    value = Path(path).read_text(encoding="utf-8").strip()
    return value or None


def env_name(unit_id):
    return "AFFETTA_OCTOBRIDGE_" + re.sub(r"[^A-Z0-9]+", "_", unit_id.upper()).strip("_") + "_TOKEN"


def required_string(value, field):
    result = str(value or "").strip()
    if not result:
        raise ValueError("Campo obbligatorio mancante: " + field)
    return result


def main():
    parser = argparse.ArgumentParser(description="Configura una singola unità Affetta OctoBridge.")
    parser.add_argument("--machine", required=True, type=Path)
    parser.add_argument("--base-config", required=True, type=Path)
    parser.add_argument("--config-out", required=True, type=Path)
    parser.add_argument("--catalog-out", required=True, type=Path)
    parser.add_argument("--registration-out", required=True, type=Path)
    parser.add_argument("--serial-port", default="AUTO")
    parser.add_argument("--octoprint-url", default="http://127.0.0.1:5000")
    parser.add_argument("--octoprint-api-key-file", type=Path)
    parser.add_argument("--bridge-token-file", type=Path)
    parser.add_argument("--enable-experimental-printing", action="store_true")
    parser.add_argument("--rotate-bridge-token", action="store_true")
    parser.add_argument("--endpoint-host")
    parser.add_argument("--bridge-port", type=int, default=8792)
    args = parser.parse_args()

    machine = read_json(args.machine)
    base = read_json(args.base_config)

    fleet_unit_id = required_string(machine.get("fleet_unit_id"), "fleet_unit_id")
    display_name = required_string(machine.get("display_name"), "display_name")
    model = required_string(machine.get("model"), "model")
    profile_id = required_string(machine.get("printer_profile_id"), "printer_profile_id")
    bridge_id = required_string(machine.get("bridge_id"), "bridge_id")
    hostname = required_string(machine.get("hostname"), "hostname")

    existing = {}
    if args.config_out.exists():
        try:
            existing = read_json(args.config_out)
        except Exception:
            existing = {}

    api_key = read_secret_file(args.octoprint_api_key_file)
    if not api_key:
        api_key = str(existing.get("octoprint_api_key") or "").strip()
    if not api_key and sys.stdin.isatty():
        api_key = getpass.getpass("API key OctoPrint: ").strip()
    if len(api_key or "") < 10:
        raise SystemExit("API key OctoPrint assente o troppo corta.")

    preprovisioned_bridge_token = read_secret_file(args.bridge_token_file)
    if preprovisioned_bridge_token:
        if len(preprovisioned_bridge_token) < 32:
            raise SystemExit("Token bridge pre-provisionato assente o troppo corto.")
        bridge_token = preprovisioned_bridge_token
    else:
        bridge_token = str(existing.get("api_token") or "").strip()
        if args.rotate_bridge_token or len(bridge_token) < 32:
            bridge_token = secrets.token_hex(32)

    serial_port = str(args.serial_port or "AUTO").strip()
    if not serial_port:
        serial_port = "AUTO"

    config = dict(base)
    config.update({
        "schema_version": "affetta.octobridge-config.v1",
        "release_channel": "experimental",
        "production_ready": False,
        "bridge_id": bridge_id,
        "fleet_unit_id": fleet_unit_id,
        "display_name": display_name,
        "bind_host": "0.0.0.0",
        "bind_port": int(args.bridge_port),
        "api_token": bridge_token,
        "data_dir": "/var/lib/affetta-octobridge",
        "printer_catalog": "/opt/affetta-octobridge/config/printer-catalog.json",
        "printer_profile_id": profile_id,
        "serial_port": serial_port,
        "baudrate": machine.get("baudrate", "AUTO"),
        "octoprint_url": args.octoprint_url.rstrip("/"),
        "octoprint_api_key": api_key,
        "verify_remote_sha256": True,
        "require_pre_print_snapshot": bool(machine.get("camera_enabled", False)),
        "serial_printing_enabled": bool(args.enable_experimental_printing),
        "physical_validation_stage": (
            "experimental_testing" if args.enable_experimental_printing else "not_started"
        )
    })

    camera = dict(config.get("camera") or {})
    if machine.get("camera_enabled", False):
        camera["command"] = camera.get("command") or "auto"
    else:
        camera["command"] = ""
    config["camera"] = camera

    catalog = {
        "schema_version": "affetta.octobridge-printer-catalog.v2",
        "release_channel": "experimental",
        "production_ready": False,
        "selection_does_not_modify_gcode": True,
        "printers": [{
            "id": profile_id,
            "fleet_unit_id": fleet_unit_id,
            "name": display_name,
            "model": model,
            "selectable": True,
            "transport": "serial_candidate",
            "octobridge_serial_eligible": True,
            "activation": "experimental",
            "serial": {
                "port": serial_port,
                "baudrate": machine.get("baudrate", "AUTO")
            },
            "hardware": {
                "nozzle_mm": machine.get("nozzle_mm"),
                "filament_diameter_mm": machine.get("filament_diameter_mm"),
                "firmware": machine.get("firmware", "TO_VERIFY"),
                "board": machine.get("board", "TO_VERIFY")
            },
            "notes": machine.get("notes", ""),
            "production_ready": False
        }]
    }

    endpoint_host = (args.endpoint_host or hostname + ".local").strip()
    token_env = env_name(fleet_unit_id)
    registration = {
        "schema_version": "affetta.server-lite-octobridge-registration.v1",
        "generated_by": "AFFETTA_OCTOBRIDGE_LAB_V2",
        "printer": {
            "id": fleet_unit_id,
            "name": display_name,
            "model": model,
            "adapter": "octobridge",
            "enabled": True,
            "endpoint": "http://{0}:{1}".format(endpoint_host, args.bridge_port),
            "api_key": "env:" + token_env,
            "options": {
                "bridge_id": bridge_id,
                "printer_profile_id": profile_id,
                "release_channel": "experimental",
                "production_ready": False
            }
        },
        "secret": {
            "environment_variable": token_env,
            "value": bridge_token
        },
        "bridge": {
            "bridge_id": bridge_id,
            "fleet_unit_id": fleet_unit_id,
            "hostname": hostname,
            "local_endpoint": "http://{0}:{1}".format(endpoint_host, args.bridge_port)
        }
    }

    atomic_json(args.config_out, config, 0o640)
    atomic_json(args.catalog_out, catalog, 0o644)
    atomic_json(args.registration_out, registration, 0o600)

    print("Configurazione creata per: " + display_name)
    print("Bridge ID: " + bridge_id)
    print("Hostname: " + hostname)
    print("Profilo: " + profile_id)
    print("Porta seriale: " + serial_port)
    print("Stampa seriale sperimentale: " + str(bool(args.enable_experimental_printing)).lower())
    print("production_ready: false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
