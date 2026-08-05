#!/usr/bin/env python3
from __future__ import print_function

import argparse
import json
import re
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--unit", required=True, help="numero unità, es. 01")
    parser.add_argument("--name", help="nome visibile opzionale")
    parser.add_argument("--nozzle-mm", type=float, default=0.4)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    unit = str(args.unit).strip()
    if not re.match(r"^[0-9]{2}$", unit):
        raise SystemExit("--unit deve avere due cifre, es. 01")

    fleet_id = "prusa-i3-" + unit
    display = args.name or ("Prusa i3 autocostruita " + unit)
    doc = {
        "schema_version": "affetta.lab-octobridge-machine.v2",
        "release_channel": "experimental",
        "production_ready": False,
        "transport": "octobridge",
        "serial_printing_enabled_default": False,
        "fleet_unit_id": fleet_id,
        "display_name": display,
        "model": "Prusa i3 autocostruita",
        "printer_profile_id": "prusa-i3-autocostruita",
        "bridge_id": "octobridge-" + fleet_id,
        "hostname": "affetta-" + fleet_id,
        "nozzle_mm": args.nozzle_mm,
        "filament_diameter_mm": 1.75,
        "firmware": "TO_VERIFY",
        "board": "RAMPS 1.4 / TO_VERIFY",
        "baudrate": "AUTO",
        "camera_enabled": False,
        "notes": "Unità generata dal pool Prusa; censire elettronica, firmware e calibrazione."
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(str(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
