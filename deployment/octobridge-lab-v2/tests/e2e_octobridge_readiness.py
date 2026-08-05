#!/usr/bin/env python3
"""Test end-to-end reale tra OctoBridge e Fake OctoPrint.

Il test usa il codice OctoBridge presente nel repository Affetta, non una copia.
Compatibile con Python 3.7+. Non richiede Raspberry, seriale o microSD.
"""
from __future__ import print_function

import argparse
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


def wait_until(predicate, timeout=20.0, interval=0.25, description='condizione'):
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
    raise AssertionError('Timeout in attesa di %s; ultimo=%r' % (description, last))


class HttpClient(object):
    def __init__(self, base, token=None, api_key=None, control_key=None):
        self.base = base.rstrip('/')
        self.token = token
        self.api_key = api_key
        self.control_key = control_key

    def request(self, method, path, payload=None, raw=None, headers=None, expected=None):
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
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=request_headers)
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                data = response.read()
                status = response.status
                content_type = response.headers.get('Content-Type', '')
        except urllib.error.HTTPError as error:
            data = error.read()
            status = error.code
            content_type = error.headers.get('Content-Type', '') if error.headers else ''
        if expected is not None:
            allowed = expected if isinstance(expected, (list, tuple, set)) else [expected]
            if status not in allowed:
                raise AssertionError('%s %s: HTTP %s, atteso %s, body=%r' % (method, path, status, allowed, data[:500]))
        if not data:
            return status, None
        if 'application/json' in content_type or data[:1] in (b'{', b'['):
            return status, json.loads(data.decode('utf-8'))
        return status, data


class ProcessGuard(object):
    def __init__(self, command, env, log_path, cwd=None):
        self.log_handle = open(str(log_path), 'ab', buffering=0)
        self.process = subprocess.Popen(
            command,
            cwd=str(cwd) if cwd else None,
            env=env,
            stdout=self.log_handle,
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
        self.log_handle.close()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')


def job_metadata(job_id, filename, data, profile='anycubic-predator', digest=None):
    return {
        'job_id': job_id,
        'affetta_job_id': job_id,
        'filename': filename,
        'display_name': filename,
        'size_bytes': len(data),
        'sha256': digest or hashlib.sha256(data).hexdigest(),
        'printer_profile_id': profile,
        'source': {'test': 'octobridge-readiness'}
    }


def stage_and_transfer(client, job_id, data, filename=None):
    filename = filename or (job_id + '.gcode')
    metadata = job_metadata(job_id, filename, data)
    client.request('POST', '/v1/jobs', payload=metadata, expected=201)
    client.request(
        'PUT', '/v1/jobs/%s/gcode' % urllib.parse.quote(job_id), raw=data,
        headers={'Content-Type': 'application/octet-stream', 'Content-Length': str(len(data))},
        expected=200
    )
    _, transferred = client.request('POST', '/v1/jobs/%s/transfer' % urllib.parse.quote(job_id), payload={}, expected=200)
    if transferred.get('state') != 'transferred':
        raise AssertionError('Job non trasferito: %r' % transferred)
    return transferred


def start_and_wait_printing(client, job_id):
    client.request('POST', '/v1/jobs/%s/start' % urllib.parse.quote(job_id), payload={}, expected=200)
    def printing():
        _, job = client.request('GET', '/v1/jobs/%s' % urllib.parse.quote(job_id), expected=200)
        return job if job.get('state') == 'printing' else None
    return wait_until(printing, timeout=15, description='job %s printing' % job_id)


def wait_job_state(client, job_id, expected_state, timeout=15):
    def check():
        _, job = client.request('GET', '/v1/jobs/%s' % urllib.parse.quote(job_id), expected=200)
        return job if job.get('state') == expected_state else None
    return wait_until(check, timeout=timeout, description='job %s=%s' % (job_id, expected_state))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', type=Path)
    parser.add_argument('--keep-temp', action='store_true')
    args = parser.parse_args()

    package_root = Path(__file__).resolve().parents[1]
    repo_root = (args.repo_root or package_root.parents[2]).resolve()
    octobridge_root = repo_root / 'octobridge-zero'
    module_root = octobridge_root / 'affetta_octobridge'
    if not module_root.is_dir():
        raise SystemExit('Codice OctoBridge non trovato: %s' % module_root)

    temporary = tempfile.TemporaryDirectory(prefix='affetta-octobridge-e2e-')
    work = Path(temporary.name)
    print('[INFO] Repository:', repo_root)
    print('[INFO] Runtime test:', work)

    fake_port = free_port()
    bridge_port = free_port()
    api_key = 'E2E_OCTOPRINT_API_KEY_1234567890'
    control_key = 'E2E_SIMULATOR_CONTROL'
    bridge_token = 'e2e-bridge-token-' + ('a' * 48)

    config_path = work / 'config.json'
    catalog_path = work / 'printer-catalog.json'
    data_dir = work / 'bridge-data'
    fake_data = work / 'fake-data'
    config = {
        'schema_version': 'affetta.octobridge-config.v1',
        'release_channel': 'experimental',
        'production_ready': False,
        'bridge_id': 'e2e-predator-01',
        'bind_host': '127.0.0.1',
        'bind_port': bridge_port,
        'api_token': bridge_token,
        'data_dir': str(data_dir),
        'printer_catalog': str(catalog_path),
        'printer_profile_id': 'anycubic-predator',
        'serial_port': 'AUTO',
        'baudrate': 'AUTO',
        'octoprint_url': 'http://127.0.0.1:%d' % fake_port,
        'octoprint_api_key': api_key,
        'poll_seconds': 2,
        'request_timeout_seconds': 5,
        'max_gcode_bytes': 10485760,
        'verify_remote_sha256': True,
        'require_pre_print_snapshot': False,
        'retention_days_after_sync': 30,
        'camera': {'command': '', 'width': 640, 'height': 480, 'quality': 75, 'timeout_ms': 1000, 'rotation': 0},
        'live': {'enabled_on_demand_only': True, 'default_seconds': 10, 'max_seconds': 20, 'width': 320, 'height': 240, 'fps': 1, 'max_parallel_sessions': 1},
        'serial_printing_enabled': True,
        'physical_validation_stage': 'simulated_e2e',
        'serial_connect_timeout_seconds': 10
    }
    catalog = {
        'schema_version': 'affetta.octobridge-printer-catalog.v2',
        'release_channel': 'experimental',
        'production_ready': False,
        'printers': [{
            'id': 'anycubic-predator', 'name': 'Anycubic Predator E2E',
            'model': 'Anycubic Predator', 'selectable': True,
            'transport': 'serial_candidate', 'production_ready': False
        }]
    }
    write_json(config_path, config)
    write_json(catalog_path, catalog)

    env = os.environ.copy()
    env['PYTHONPATH'] = str(octobridge_root)
    env['AFFETTA_OCTOBRIDGE_CONFIG'] = str(config_path)
    env['PYTHONUNBUFFERED'] = '1'

    fake = None
    bridge = None
    try:
        fake = ProcessGuard([
            sys.executable, str(package_root / 'simulator' / 'fake_octoprint.py'),
            '--host', '127.0.0.1', '--port', str(fake_port),
            '--api-key', api_key, '--control-key', control_key,
            '--data-dir', str(fake_data)
        ], os.environ.copy(), work / 'fake-octoprint.log')
        fake_client = HttpClient('http://127.0.0.1:%d' % fake_port, api_key=api_key)
        control = HttpClient('http://127.0.0.1:%d' % fake_port, control_key=control_key)
        wait_until(lambda: fake_client.request('GET', '/api/version', expected=200)[1], description='Fake OctoPrint')

        def start_bridge():
            return ProcessGuard(
                [sys.executable, '-m', 'affetta_octobridge'], env,
                work / ('octobridge-%d.log' % int(time.time() * 1000)), cwd=octobridge_root
            )

        bridge = start_bridge()
        bridge_client = HttpClient('http://127.0.0.1:%d' % bridge_port, token=bridge_token)
        health_client = HttpClient('http://127.0.0.1:%d' % bridge_port)
        wait_until(lambda: health_client.request('GET', '/health', expected=200)[1], description='OctoBridge health')

        print('[TEST] autenticazione Bearer obbligatoria')
        status, _ = health_client.request('GET', '/v1/status', expected=401)
        assert status == 401

        print('[TEST] blocco G-code con SHA-256 errato')
        bad_data = b'G28\nM105\n'
        bad = job_metadata('e2e-bad-sha', 'bad.gcode', bad_data, digest='0' * 64)
        bridge_client.request('POST', '/v1/jobs', payload=bad, expected=201)
        bridge_client.request(
            'PUT', '/v1/jobs/e2e-bad-sha/gcode', raw=bad_data,
            headers={'Content-Type': 'application/octet-stream', 'Content-Length': str(len(bad_data))},
            expected=400
        )

        print('[TEST] corruzione remota rilevata e retry idempotente')
        retry_data = b'; Affetta retry test\nG28\nG1 X20 Y20 F1200\n'
        retry_id = 'e2e-remote-retry'
        metadata = job_metadata(retry_id, 'retry.gcode', retry_data)
        bridge_client.request('POST', '/v1/jobs', payload=metadata, expected=201)
        bridge_client.request(
            'PUT', '/v1/jobs/%s/gcode' % retry_id, raw=retry_data,
            headers={'Content-Type': 'application/octet-stream', 'Content-Length': str(len(retry_data))}, expected=200
        )
        control.request('POST', '/__simulator__/corrupt-next-download', payload={}, expected=200)
        bridge_client.request('POST', '/v1/jobs/%s/transfer' % retry_id, payload={}, expected=502)
        _, retry_job = bridge_client.request('GET', '/v1/jobs/%s' % retry_id, expected=200)
        assert retry_job['state'] == 'staged', retry_job
        bridge_client.request('POST', '/v1/jobs/%s/transfer' % retry_id, payload={}, expected=200)

        print('[TEST] ciclo completo, pausa, ripresa e completamento')
        job1 = 'e2e-complete'
        data1 = b'; Affetta E2E complete\nG28\nG1 X10 Y10 F1000\nM84\n'
        stage_and_transfer(bridge_client, job1, data1)
        start_and_wait_printing(bridge_client, job1)
        control.request('POST', '/__simulator__/progress', payload={'completion': 25}, expected=200)
        wait_until(lambda: bridge_client.request('GET', '/v1/status', expected=200)[1]['printer_snapshot'].get('progress_percent') == 25.0,
                   timeout=10, description='progresso 25%')
        bridge_client.request('POST', '/v1/jobs/%s/pause' % job1, payload={}, expected=200)
        wait_job_state(bridge_client, job1, 'paused')
        bridge_client.request('POST', '/v1/jobs/%s/resume' % job1, payload={}, expected=200)
        wait_job_state(bridge_client, job1, 'printing')
        control.request('POST', '/__simulator__/complete', payload={}, expected=200)
        wait_job_state(bridge_client, job1, 'completed')

        print('[TEST] pending sync, eventi e acknowledge')
        _, pending = bridge_client.request('GET', '/v1/sync/pending', expected=200)
        pending_ids = [item.get('job_id') for item in pending.get('jobs', [])]
        assert job1 in pending_ids, pending
        _, events = bridge_client.request('GET', '/v1/jobs/%s/events?after=0' % job1, expected=200)
        sequence = max([int(event.get('sequence', 0)) for event in events.get('events', [])] or [0])
        bridge_client.request('POST', '/v1/jobs/%s/sync-ack' % job1,
                              payload={'event_sequence': sequence, 'files': []}, expected=200)

        print('[TEST] annullamento confermato da OctoPrint')
        job2 = 'e2e-cancel'
        stage_and_transfer(bridge_client, job2, b'; cancel\nG28\nG4 P5000\n')
        start_and_wait_printing(bridge_client, job2)
        bridge_client.request('POST', '/v1/jobs/%s/cancel' % job2, payload={}, expected=200)
        wait_job_state(bridge_client, job2, 'cancelled')

        print('[TEST] errore macchina esplicito')
        job3 = 'e2e-failure'
        stage_and_transfer(bridge_client, job3, b'; fail\nG28\nG1 X5\n')
        start_and_wait_printing(bridge_client, job3)
        control.request('POST', '/__simulator__/fail', payload={}, expected=200)
        wait_job_state(bridge_client, job3, 'failed')
        control.request('POST', '/__simulator__/online', payload={}, expected=200)

        print('[TEST] completamento durante spegnimento Affetta e riconciliazione')
        job4 = 'e2e-reconcile-complete'
        stage_and_transfer(bridge_client, job4, b'; reconcile\nG28\nG1 X30\n')
        start_and_wait_printing(bridge_client, job4)
        bridge.stop()
        bridge = None
        control.request('POST', '/__simulator__/complete', payload={}, expected=200)
        bridge = start_bridge()
        wait_until(lambda: health_client.request('GET', '/health', expected=200)[1], timeout=15, description='OctoBridge restart')
        wait_job_state(bridge_client, job4, 'completed', timeout=15)

        print('[TEST] OctoPrint irraggiungibile non abbatte API bridge')
        fake.stop()
        fake = None
        def unreachable():
            _, status_payload = bridge_client.request('GET', '/v1/status', expected=200)
            return status_payload if status_payload['printer_snapshot'].get('connection_status') == 'unreachable' else None
        wait_until(unreachable, timeout=10, description='status unreachable')
        health_client.request('GET', '/health', expected=200)

        print('[OK] Tutti gli scenari software OctoBridge sono superati.')
        print('[OK] Log disponibili in:', work)
        return 0
    finally:
        if bridge is not None:
            bridge.stop()
        if fake is not None:
            fake.stop()
        if args.keep_temp:
            print('[INFO] --keep-temp richiesto; copiare i log prima della chiusura:', work)
            temporary.cleanup = lambda: None
        else:
            temporary.cleanup()


if __name__ == '__main__':
    raise SystemExit(main())
