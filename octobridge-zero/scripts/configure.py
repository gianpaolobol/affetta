#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

DEFAULT_CONFIG = Path("/etc/affetta-octobridge/config.json")
DEFAULT_CATALOG = Path("/opt/affetta-octobridge/config/printer-catalog.json")


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Configura Affetta OctoBridge Zero Snapshot")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--list", action="store_true", help="elenca i profili selezionabili")
    parser.add_argument("--profile", help="ID profilo stampante")
    parser.add_argument("--bridge-id", help="identificativo univoco del bridge")
    parser.add_argument("--serial-port", default=None, help="AUTO oppure /dev/ttyUSB0")
    parser.add_argument("--baudrate", default=None, help="AUTO oppure valore numerico")
    parser.add_argument("--enable-experimental-printing", action="store_true",
                        help="abilita l'invio seriale solo per profili candidati; non rende la build production-ready")
    parser.add_argument("--disable-printing", action="store_true")
    parser.add_argument("--restart", action="store_true")
    args = parser.parse_args()

    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    profiles = {item["id"]: item for item in catalog.get("printers", [])}
    if args.list:
        for item in profiles.values():
            status = "candidato seriale" if item.get("octobridge_serial_eligible") else "solo selezionabile/bloccato"
            print(f"{item['id']:<28} {status:<26} {item['name']}")
        return 0

    config = json.loads(args.config.read_text(encoding="utf-8"))
    if args.profile:
        selected = profiles.get(args.profile)
        if not selected:
            raise SystemExit(f"Profilo sconosciuto: {args.profile}")
        config["printer_profile_id"] = selected["id"]
        config["serial_printing_enabled"] = False
        config["physical_validation_stage"] = "not_started"
        hints = selected.get("serial") or {}
        config["serial_port"] = hints.get("port", "AUTO")
        config["baudrate"] = hints.get("baudrate", "AUTO")

    if args.bridge_id:
        config["bridge_id"] = args.bridge_id
    if args.serial_port is not None:
        config["serial_port"] = args.serial_port
    if args.baudrate is not None:
        config["baudrate"] = int(args.baudrate) if args.baudrate.isdigit() else args.baudrate
    if args.disable_printing:
        config["serial_printing_enabled"] = False
    if args.enable_experimental_printing:
        profile = profiles.get(config.get("printer_profile_id"))
        if not profile or not profile.get("octobridge_serial_eligible"):
            raise SystemExit("Il profilo selezionato non è abilitabile sul trasporto seriale OctoBridge.")
        config["serial_printing_enabled"] = True
        config["physical_validation_stage"] = "experimental_testing"

    config["release_channel"] = "experimental"
    config["production_ready"] = False
    atomic_json(args.config, config)
    print(f"Configurazione aggiornata: {args.config}")
    print(f"Profilo: {config.get('printer_profile_id')}")
    print(f"Stampa seriale sperimentale: {config.get('serial_printing_enabled', False)}")
    print("production_ready: false")
    if args.restart:
        subprocess.run(["systemctl", "restart", "affetta-octobridge.service"], check=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
