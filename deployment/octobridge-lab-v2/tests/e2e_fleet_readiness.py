#!/usr/bin/env python3
"""P4.4.3: simulazione simultanea delle 12 unità OctoBridge del laboratorio.

Usa il codice reale del repository, un Fake OctoPrint separato per ogni nodo e
verifica isolamento di token, file, stato e riconciliazione. Python 3.7+.
"""
from __future__ import print_function

import argparse
import concurrent.futures
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def free_port():
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_until(predicate, timeout=30.0, interval=0.25, description='condizione'):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            value = predicate()
            if value:
                return value
            last = value
        except Exception as error:
            last = error
        time.sleep(interval)
    raise AssertionError('Timeout %s; ultimo=%r' % (description, last))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


class HttpClient(object):
    def __init__(self, base, token=None, api_key=None, control_key=None):
        self.base = base.rstrip('/')
        self.token = token
        self.api_key = api_key
        self.control_key = control_key

    def request(self, method, path, payload=None, raw=None, headers=None, expected=None, timeout=20):
        request_headers = dict(headers or {})
        if self.token:
            request_headers['Authorization'] = 'Bearer ' + self.token
        if self.api_key:
            request_headers['X-Api-Key'] = self.api_key
        if self.control_key:
            request_headers['X-Simulator-Key'] = self.control_key
        body = raw
        if payload is not None:
            body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
            request_headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(self.base + path, data=body, method=method, headers=request_headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                data = response.read()
                status = response.status
                content_type = response.headers.get('Content-Type', '')
        except urllib.error.HTTPError as error:
            data = error.read()
            status = error.code
            content_type = error.headers.get('Content-Type', '') if error.headers else ''
        if expected is not None:
            allowed = expected if isinstance(expected, (tuple, list, set)) else [expected]
            if status not in allowed:
                raise AssertionError('%s %s: HTTP %s, atteso %s, body=%r' % (method, path, status, allowed, data[:300]))
        if not data:
            return status, None
        if 'application/json' in content_type or data[:1] in (b'{', b'['):
            return status, json.loads(data.decode('utf-8'))
        return status, data


class ProcessGuard(object):
    def __init__(self, command, env, log_path, cwd=None):
        self.command = list(command)
        self.env = dict(env)
        self.cwd = cwd
        self.log_path = Path(log_path)
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = open(str(self.log_path), 'ab', buffering=0)
        self.process = subprocess.Popen(
            self.command,
            cwd=str(cwd) if cwd else None,
            env=self.env,
            stdout=self.handle,
            stderr=subprocess.STDOUT
        )

    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.handle.close()


class Node(object):
    def __init__(self, machine, work, repo_root, package_root, ordinal):
        self.machine = machine
        self.id = machine['fleet_unit_id']
        self.work = work / self.id
        self.work.mkdir(parents=True, exist_ok=True)
        self.repo_root = repo_root
        self.package_root = package_root
        self.octobridge_root = repo_root / 'octobridge-zero'
        self.fake_port = free_port()
        self.bridge_port = free_port()
        self.api_key = 'FLEET_OCTOPRINT_%02d_%s' % (ordinal, 'a' * 32)
        self.control_key = 'FLEET_CONTROL_%02d_%s' % (ordinal, 'b' * 24)
        self.token = hashlib.sha256(('fleet-token-' + self.id).encode('utf-8')).hexdigest()
        self.fake = None
        self.bridge = None
        self.fake_data = self.work / 'fake-data'
        self.bridge_data = self.work / 'bridge-data'
        self.config_path = self.work / 'config.json'
        self.catalog_path = self.work / 'printer-catalog.json'
        self.bridge_base = 'http://127.0.0.1:%d' % self.bridge_port
        self.fake_base = 'http://127.0.0.1:%d' % self.fake_port
        self.client = HttpClient(self.bridge_base, token=self.token)
        self.health = HttpClient(self.bridge_base)
        self.fake_client = HttpClient(self.fake_base, api_key=self.api_key)
        self.control = HttpClient(self.fake_base, control_key=self.control_key)
        self.bridge_env = os.environ.copy()
        self.bridge_env['PYTHONPATH'] = str(self.octobridge_root)
        self.bridge_env['AFFETTA_OCTOBRIDGE_CONFIG'] = str(self.config_path)
        self.bridge_env['PYTHONUNBUFFERED'] = '1'
        self._write_config()

    def _write_config(self):
        profile = self.machine['printer_profile_id']
        config = {
            'schema_version': 'affetta.octobridge-config.v1',
            'release_channel': 'experimental',
            'production_ready': False,
            'bridge_id': self.machine['bridge_id'],
            'fleet_unit_id': self.id,
            'display_name': self.machine['display_name'],
            'bind_host': '127.0.0.1',
            'bind_port': self.bridge_port,
            'api_token': self.token,
            'data_dir': str(self.bridge_data),
            'printer_catalog': str(self.catalog_path),
            'printer_profile_id': profile,
            'serial_port': 'AUTO',
            'baudrate': 'AUTO',
            'octoprint_url': self.fake_base,
            'octoprint_api_key': self.api_key,
            'poll_seconds': 1,
            'request_timeout_seconds': 5,
            'max_gcode_bytes': 10485760,
            'verify_remote_sha256': True,
            'require_pre_print_snapshot': False,
            'retention_days_after_sync': 30,
            'camera': {'command': '', 'width': 640, 'height': 480, 'quality': 75, 'timeout_ms': 1000, 'rotation': 0},
            'live': {'enabled_on_demand_only': True, 'default_seconds': 10, 'max_seconds': 20, 'width': 320, 'height': 240, 'fps': 1, 'max_parallel_sessions': 1},
            'serial_printing_enabled': True,
            'physical_validation_stage': 'simulated_fleet_e2e',
            'serial_connect_timeout_seconds': 10
        }
        catalog = {
            'schema_version': 'affetta.octobridge-printer-catalog.v2',
            'release_channel': 'experimental',
            'production_ready': False,
            'printers': [{
                'id': profile,
                'fleet_unit_id': self.id,
                'name': self.machine['display_name'],
                'model': self.machine.get('model') or self.machine['display_name'],
                'selectable': True,
                'transport': 'serial_candidate',
                'production_ready': False
            }]
        }
        write_json(self.config_path, config)
        write_json(self.catalog_path, catalog)

    def start_fake(self):
        self.fake = ProcessGuard([
            sys.executable, str(self.package_root / 'simulator' / 'fake_octoprint.py'),
            '--host', '127.0.0.1', '--port', str(self.fake_port),
            '--api-key', self.api_key, '--control-key', self.control_key,
            '--data-dir', str(self.fake_data)
        ], os.environ.copy(), self.work / 'fake-octoprint.log')
        wait_until(lambda: self.fake_client.request('GET', '/api/version', expected=200)[1], description=self.id + ' fake')

    def start_bridge(self):
        self.bridge = ProcessGuard(
            [sys.executable, '-m', 'affetta_octobridge'], self.bridge_env,
            self.work / ('octobridge-%d.log' % int(time.time() * 1000)), cwd=self.octobridge_root
        )
        wait_until(lambda: self.health.request('GET', '/health', expected=200)[1], description=self.id + ' bridge')

    def stop_bridge(self):
        if self.bridge is not None:
            self.bridge.stop()
            self.bridge = None

    def stop_fake(self):
        if self.fake is not None:
            self.fake.stop()
            self.fake = None

    def stop(self):
        self.stop_bridge()
        self.stop_fake()


def metadata(node, job_id, filename, data):
    return {
        'job_id': job_id,
        'affetta_job_id': job_id,
        'filename': filename,
        'display_name': filename,
        'size_bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'printer_profile_id': node.machine['printer_profile_id'],
        'source': {'test': 'octobridge-fleet-readiness', 'fleet_unit_id': node.id}
    }


def stage_start(node):
    job_id = 'fleet-' + node.id
    filename = node.id + '.gcode'
    data = ('; AFFETTA FLEET %s\nG28\nG1 X%d Y%d F1200\n' % (node.id, len(node.id), len(node.id) + 1)).encode('utf-8')
    node.client.request('POST', '/v1/jobs', payload=metadata(node, job_id, filename, data), expected=201)
    node.client.request(
        'PUT', '/v1/jobs/%s/gcode' % urllib.parse.quote(job_id), raw=data,
        headers={'Content-Type': 'application/octet-stream', 'Content-Length': str(len(data))}, expected=200
    )
    node.client.request('POST', '/v1/jobs/%s/transfer' % job_id, payload={}, expected=200)
    node.client.request('POST', '/v1/jobs/%s/start' % job_id, payload={}, expected=200)
    return job_id


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', type=Path)
    parser.add_argument('--report-directory', type=Path)
    parser.add_argument('--keep-temp', action='store_true')
    args = parser.parse_args()

    package_root = Path(__file__).resolve().parents[1]
    repo_root = (args.repo_root or package_root.parents[2]).resolve()
    if not (repo_root / 'octobridge-zero' / 'affetta_octobridge').is_dir():
        raise SystemExit('OctoBridge non trovato: %s' % repo_root)
    index = json.loads((package_root / 'machines' / 'index.json').read_text(encoding='utf-8'))
    machines = index.get('machines') or []
    if len(machines) != 12:
        raise SystemExit('Attese 12 unità seriali, trovate %d' % len(machines))

    temp = tempfile.TemporaryDirectory(prefix='affetta-fleet-e2e-')
    work = Path(temp.name)
    report_dir = (args.report_directory or work / 'reports').resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    nodes = [Node(machine, work, repo_root, package_root, i + 1) for i, machine in enumerate(machines)]
    started = []
    report = {'schema_version': 'affetta.octobridge-fleet-readiness.v1', 'production_ready': False, 'nodes': []}

    try:
        print('[TEST] avvio 12 Fake OctoPrint e 12 OctoBridge')
        for node in nodes:
            node.start_fake()
            node.start_bridge()
            started.append(node)

        print('[TEST] identità e token isolati')
        bridge_ids = set()
        for index_value, node in enumerate(nodes):
            _, status = node.client.request('GET', '/v1/status', expected=200)
            assert status['bridge_id'] == node.machine['bridge_id'], (node.id, status)
            assert status['production_ready'] is False
            bridge_ids.add(status['bridge_id'])
            wrong = nodes[(index_value + 1) % len(nodes)].token
            HttpClient(node.bridge_base, token=wrong).request('GET', '/v1/status', expected=401)
        assert len(bridge_ids) == 12

        print('[TEST] upload, transfer e start paralleli su tutta la flotta')
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
            futures = {executor.submit(stage_start, node): node for node in nodes}
            jobs = {}
            for future in concurrent.futures.as_completed(futures):
                node = futures[future]
                jobs[node.id] = future.result()

        expected_progress = {}
        for ordinal, node in enumerate(nodes):
            progress = float(5 + ordinal * 7)
            expected_progress[node.id] = progress
            node.control.request('POST', '/__simulator__/progress', payload={'completion': progress}, expected=200)

        print('[TEST] progressi distinti, file distinti e profili duplicati non confusi')
        expected_active_files = {}
        for node in nodes:
            def ready(n=node):
                _, value = n.client.request('GET', '/v1/status', expected=200)
                observed = value['printer_snapshot'].get('progress_percent')
                return value if observed == expected_progress[n.id] else None
            status = wait_until(ready, timeout=15, description=node.id + ' progress')
            snapshot = status['printer_snapshot']
            active_file = snapshot.get('active_file') or ''
            assert active_file.startswith('affetta_' + jobs[node.id] + '_'), (node.id, snapshot)
            assert active_file.endswith('_' + node.id + '.gcode'), (node.id, snapshot)
            expected_active_files[node.id] = active_file
            assert status.get('active_job_id') == jobs[node.id], (node.id, status)
            report['nodes'].append({
                'fleet_unit_id': node.id,
                'bridge_id': status['bridge_id'],
                'progress_percent': snapshot.get('progress_percent'),
                'active_file': snapshot.get('active_file'),
                'connection_status': snapshot.get('connection_status')
            })

        adapter_manifest = work / 'server-lite-fleet.json'
        write_json(adapter_manifest, {'nodes': [{
            'id': node.id,
            'endpoint': node.bridge_base,
            'token': node.token,
            'bridge_id': node.machine['bridge_id'],
            'progress_percent': expected_progress[node.id],
            'active_file': expected_active_files[node.id]
        } for node in nodes]})
        print('[TEST] adapter Server Lite normalizza i 12 nodi')
        subprocess.check_call([
            'node', str(package_root / 'tests' / 'e2e_server_lite_fleet.mjs'),
            '--repo-root', str(repo_root), '--manifest', str(adapter_manifest)
        ], cwd=str(repo_root))

        print('[TEST] un nodo OctoPrint offline non contamina gli altri')
        offline = next(node for node in nodes if node.id == 'wasp-2040-02')
        offline.stop_fake()
        wait_until(
            lambda: offline.client.request('GET', '/v1/status', expected=200)[1]['printer_snapshot'].get('connection_status') == 'unreachable',
            timeout=15, description='wasp-2040-02 unreachable'
        )
        offline.health.request('GET', '/health', expected=200)
        for node in nodes:
            if node is offline:
                continue
            _, status = node.client.request('GET', '/v1/status', expected=200)
            assert status['printer_snapshot'].get('connection_status') != 'unreachable', node.id

        print('[TEST] completamento autonomo e riconciliazione dopo riavvio bridge')
        reconcile = next(node for node in nodes if node.id == 'predator-01')
        reconcile.stop_bridge()
        reconcile.control.request('POST', '/__simulator__/complete', payload={}, expected=200)
        reconcile.start_bridge()
        wait_until(
            lambda: reconcile.client.request('GET', '/v1/jobs/%s' % jobs[reconcile.id], expected=200)[1].get('state') == 'completed',
            timeout=20, description='predator-01 completed after restart'
        )

        print('[TEST] annullamento e guasto restano associati al nodo corretto')
        cancel = next(node for node in nodes if node.id == 'mini-01')
        cancel.client.request('POST', '/v1/jobs/%s/cancel' % jobs[cancel.id], payload={}, expected=200)
        wait_until(lambda: cancel.client.request('GET', '/v1/jobs/%s' % jobs[cancel.id], expected=200)[1].get('state') == 'cancelled', description='mini-01 cancelled')
        fail = next(node for node in nodes if node.id == 'taz-03')
        fail.control.request('POST', '/__simulator__/fail', payload={}, expected=200)
        wait_until(lambda: fail.client.request('GET', '/v1/jobs/%s' % jobs[fail.id], expected=200)[1].get('state') == 'failed', description='taz-03 failed')

        report['overall'] = 'PASS'
        report['software_ready'] = True
        report['hardware_validation_pending'] = True
        report_path = report_dir / 'fleet-readiness.json'
        write_json(report_path, report)
        print('[OK] Fleet readiness PASS: 12 nodi isolati e riconciliati.')
        print('[OK] Report:', report_path)
        return 0
    finally:
        for node in reversed(started):
            node.stop()
        if args.keep_temp:
            print('[INFO] Runtime conservato:', work)
            temp.cleanup = lambda: None
        else:
            temp.cleanup()


if __name__ == '__main__':
    raise SystemExit(main())
