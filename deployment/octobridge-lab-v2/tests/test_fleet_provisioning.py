#!/usr/bin/env python3
from __future__ import print_function
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    package = Path(__file__).resolve().parents[1]
    configure = package / 'lib' / 'configure_instance.py'
    machine = package / 'machines' / 'predator-01.json'
    with tempfile.TemporaryDirectory(prefix='affetta-provisioning-test-') as tmp_name:
        tmp = Path(tmp_name)
        base = tmp / 'base.json'
        api = tmp / 'api.txt'
        token = tmp / 'token.txt'
        config = tmp / 'config.json'
        catalog = tmp / 'catalog.json'
        registration = tmp / 'registration.json'
        base.write_text(json.dumps({
            'schema_version': 'affetta.octobridge-config.v1',
            'production_ready': False,
            'camera': {}, 'live': {}
        }), encoding='utf-8')
        api.write_text('OCTOPRINT_TEST_API_KEY_1234567890\n', encoding='utf-8')
        expected_token = 'f' * 64
        token.write_text(expected_token + '\n', encoding='utf-8')
        subprocess.check_call([
            sys.executable, str(configure), '--machine', str(machine),
            '--base-config', str(base), '--config-out', str(config),
            '--catalog-out', str(catalog), '--registration-out', str(registration),
            '--octoprint-api-key-file', str(api), '--bridge-token-file', str(token),
            '--endpoint-host', 'affetta-predator-01.local'
        ])
        conf = json.loads(config.read_text(encoding='utf-8'))
        reg = json.loads(registration.read_text(encoding='utf-8'))
        assert conf['api_token'] == expected_token
        assert conf['serial_printing_enabled'] is False
        assert conf['production_ready'] is False
        assert reg['secret']['value'] == expected_token
        assert reg['printer']['id'] == 'predator-01'
        assert reg['printer']['api_key'].startswith('env:AFFETTA_OCTOBRIDGE_')
    print('[OK] Pre-provisioning token e registrazione coerenti.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
