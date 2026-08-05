#!/usr/bin/env python3
from __future__ import print_function

import argparse
import json
import os
import sys
from pathlib import Path


def load(path):
    with Path(path).open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(str(path) + " non contiene un oggetto JSON.")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    args = parser.parse_args()

    config = load(args.config)
    catalog = load(args.catalog)
    errors = []

    required = (
        "bridge_id", "bind_host", "bind_port", "api_token", "data_dir",
        "printer_catalog", "printer_profile_id", "serial_port",
        "octoprint_url", "octoprint_api_key"
    )
    for field in required:
        if config.get(field) in (None, ""):
            errors.append("Campo config mancante: " + field)

    if len(str(config.get("api_token") or "")) < 32:
        errors.append("api_token deve avere almeno 32 caratteri.")

    if config.get("production_ready") is True:
        errors.append("L'installer non può impostare production_ready=true.")

    serial_port = config.get("serial_port")
    if serial_port not in (None, "", "AUTO"):
        resolved = os.path.realpath(str(serial_port))
        if not os.path.exists(resolved):
            errors.append("Porta seriale configurata ma non presente: " + str(serial_port))

    profiles = {}
    for item in catalog.get("printers") or []:
        if isinstance(item, dict) and item.get("id"):
            profiles[str(item["id"])] = item

    profile_id = str(config.get("printer_profile_id") or "")
    if profile_id not in profiles:
        errors.append("printer_profile_id non presente nel catalogo: " + profile_id)

    if errors:
        for error in errors:
            print("[ERRORE] " + error, file=sys.stderr)
        return 1

    print("[OK] Configurazione OctoBridge valida.")
    print("[OK] bridge_id=" + str(config.get("bridge_id")))
    print("[OK] printer_profile_id=" + profile_id)
    print("[OK] serial_printing_enabled=" + str(bool(config.get("serial_printing_enabled"))).lower())
    print("[OK] production_ready=false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
