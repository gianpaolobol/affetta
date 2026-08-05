#!/usr/bin/env python3
from __future__ import print_function
import json
import re
import sys
from pathlib import Path


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
    index = json.loads((root / 'machines' / 'index.json').read_text(encoding='utf-8'))
    machines = index.get('machines') or []
    assert len(machines) == 12, len(machines)
    keys = ('fleet_unit_id', 'hostname', 'bridge_id')
    for key in keys:
        values = [item[key] for item in machines]
        assert len(values) == len(set(values)), key
    required = [
        'fleet/New-AffettaFleetProvisioning.ps1',
        'fleet/Build-AffettaSourceOfflineBundle.ps1',
        'fleet/Prepare-Predator01Pilot.ps1',
        'tests/e2e_fleet_readiness.py',
        'tests/e2e_server_lite_fleet.mjs',
        'tests/test_fleet_provisioning.py',
        'docs/PREDATOR_01_PILOT_RUNBOOK.md',
        'docs/SD_ARRIVAL_DAY_CHECKLIST.md'
    ]
    for relative in required:
        assert (root / relative).is_file(), relative
    for path in root.rglob('*'):
        if path.resolve() == Path(__file__).resolve():
            continue
        if path.is_file() and path.suffix.lower() in ('.json', '.py', '.ps1', '.sh', '.md', '.mjs', '.yml'):
            text = path.read_text(encoding='utf-8', errors='strict')
            assert 'production_ready": true' not in text.lower(), str(path)
            assert not re.search(r'(?i)(api[_-]?key|token)\s*[:=]\s*["\']?[A-Za-z0-9_-]{40,}', text), str(path)
    print('[OK] P4.4.3: 12 nodi, strumenti presenti, nessun segreto o production_ready=true.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
