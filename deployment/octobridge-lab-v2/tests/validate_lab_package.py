#!/usr/bin/env python3
from __future__ import print_function

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SECRET_PATTERNS = [
    re.compile(r'psk\s*=\s*["\'][^"\']+["\']', re.I),
    re.compile(r'"(?:api_token|octoprint_api_key)"\s*:\s*"(?!REPLACE|AFFETTA_|E2E_|TEST_)[^"]{12,}"', re.I),
    re.compile(r'BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY', re.I),
]

EXPECTED_IDS = {
    'taz-01', 'taz-02', 'taz-03', 'mini-01', 'mini-02',
    'wasp-2040-01', 'wasp-2040-02', 'wasp-2040-03',
    'wasp-turbo-01', 'wasp-turbo-02', 'predator-01', 'predator-02'
}


def load(path):
    with path.open('r', encoding='utf-8') as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path)
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parents[1]).resolve()
    errors = []

    machine_files = sorted((root / 'machines').glob('*.json'))
    machine_files = [path for path in machine_files if path.name != 'index.json']
    ids = set()
    hostnames = set()
    bridge_ids = set()
    for path in machine_files:
        doc = load(path)
        unit_id = str(doc.get('fleet_unit_id') or '')
        if unit_id in ids:
            errors.append('fleet_unit_id duplicato: ' + unit_id)
        ids.add(unit_id)
        hostname = str(doc.get('hostname') or '')
        bridge_id = str(doc.get('bridge_id') or '')
        if hostname in hostnames:
            errors.append('hostname duplicato: ' + hostname)
        if bridge_id in bridge_ids:
            errors.append('bridge_id duplicato: ' + bridge_id)
        hostnames.add(hostname)
        bridge_ids.add(bridge_id)
        if doc.get('production_ready') is not False:
            errors.append(path.name + ': production_ready deve essere false')
        if doc.get('serial_printing_enabled_default') is not False:
            errors.append(path.name + ': serial_printing_enabled_default deve essere false')
        installer = root / 'installers' / ('install-' + unit_id + '.sh')
        if not installer.is_file():
            errors.append('installer mancante per ' + unit_id)
    if ids != EXPECTED_IDS:
        errors.append('inventario unità differente dall’atteso: %r' % sorted(ids))

    index = load(root / 'machines' / 'index.json')
    indexed = {str(item.get('fleet_unit_id')) for item in index.get('machines', [])}
    if indexed != EXPECTED_IDS:
        errors.append('machines/index.json non allineato ai manifest')
    pool = index.get('uncounted_pool') or {}
    if int(pool.get('configured_units', -1)) != 0:
        errors.append('pool Prusa deve restare configured_units=0 finché non censito')

    excluded = load(root / 'server-lite' / 'native-and-separated-machines.json')
    transports = {item.get('id'): item.get('transport') for item in excluded.get('machines', [])}
    required_transports = {
        'x1c-01': 'bambu-lan',
        'snapmaker-u1-01': 'snapmaker-lan',
        'v400-01': 'moonraker',
        'thing-o-matic-01': 'x3g_external',
        'phrozen-mini4k-01': 'resin_separate'
    }
    if transports != required_transports:
        errors.append('trasporti non-OctoBridge non allineati')

    for path in root.rglob('*.json'):
        try:
            doc = load(path)
        except Exception as error:
            errors.append('%s: JSON non valido: %s' % (path, error))
            continue
        if isinstance(doc, dict) and doc.get('production_ready') is True:
            errors.append('%s imposta production_ready=true' % path)

    for path in root.rglob('*'):
        if not path.is_file() or path.name == 'SHA256SUMS.txt':
            continue
        try:
            text = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(text):
                errors.append('%s contiene un possibile segreto: %s' % (path, pattern.pattern))

    if errors:
        for error in errors:
            print('[ERRORE] ' + error, file=sys.stderr)
        return 1
    print('[OK] 12 unità seriali univoche e installer presenti.')
    print('[OK] Macchine native/separate escluse da OctoBridge.')
    print('[OK] Nessun production_ready=true o segreto evidente.')
    print('[OK] Pool Prusa non inventariato mantenuto a zero.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
