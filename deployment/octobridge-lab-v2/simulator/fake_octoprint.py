#!/usr/bin/env python3
"""Fake OctoPrint deterministico per i test Affetta/OctoBridge.

Compatibile con Python 3.7+. Implementa solo le API effettivamente usate da
Affetta OctoBridge e offre endpoint di controllo locali per gli scenari E2E.
Non deve essere esposto fuori da localhost.
"""
from __future__ import print_function

import argparse
import json
import os
import re
import signal
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


FILE_RE = re.compile(r'name="file";\s*filename="([^"]+)"', re.I)


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.tmp')
    with temporary.open('w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(str(temporary), str(path))


class SimulatorState(object):
    def __init__(self, data_dir, auto_progress=False, auto_step=5.0, auto_interval=1.0):
        self.data_dir = Path(data_dir)
        self.files_dir = self.data_dir / 'files'
        self.state_path = self.data_dir / 'state.json'
        self.files_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.auto_progress = bool(auto_progress)
        self.auto_step = float(auto_step)
        self.auto_interval = float(auto_interval)
        self.stop_event = threading.Event()
        self.thread = None
        self.value = self._load()

    def _default(self):
        return {
            'connection_state': 'Operational',
            'job_state': 'Operational',
            'active_file': None,
            'progress': 0.0,
            'print_time': 0,
            'print_time_left': None,
            'temperatures': {
                'tool0': {'actual': 24.0, 'target': 0.0, 'offset': 0},
                'bed': {'actual': 24.0, 'target': 0.0, 'offset': 0}
            },
            'files': {},
            'fault': None,
            'corrupt_next_download': False,
            'request_count': 0
        }

    def _load(self):
        if not self.state_path.exists():
            value = self._default()
            atomic_json(self.state_path, value)
            return value
        try:
            with self.state_path.open('r', encoding='utf-8') as handle:
                value = json.load(handle)
            if not isinstance(value, dict):
                raise ValueError('state non oggetto')
            default = self._default()
            default.update(value)
            return default
        except Exception:
            value = self._default()
            atomic_json(self.state_path, value)
            return value

    def save(self):
        atomic_json(self.state_path, self.value)

    def snapshot(self):
        with self.lock:
            return json.loads(json.dumps(self.value))

    def mutate(self, callback):
        with self.lock:
            callback(self.value)
            self.save()
            return self.snapshot()

    def reset(self):
        with self.lock:
            for path in self.files_dir.iterdir():
                if path.is_file():
                    path.unlink()
            self.value = self._default()
            self.save()
            return self.snapshot()

    def start_auto(self):
        if not self.auto_progress or self.thread is not None:
            return
        self.thread = threading.Thread(target=self._auto_loop, name='fake-octoprint-progress', daemon=True)
        self.thread.start()

    def stop_auto(self):
        self.stop_event.set()
        if self.thread is not None:
            self.thread.join(timeout=3)

    def _auto_loop(self):
        while not self.stop_event.wait(self.auto_interval):
            with self.lock:
                if self.value.get('job_state') != 'Printing':
                    continue
                next_value = min(100.0, float(self.value.get('progress') or 0.0) + self.auto_step)
                self._set_progress_locked(next_value)
                if next_value >= 100.0:
                    self._complete_locked(True)
                self.save()

    def _set_progress_locked(self, progress):
        progress = max(0.0, min(100.0, float(progress)))
        self.value['progress'] = progress
        self.value['print_time'] = int(progress * 6)
        self.value['print_time_left'] = max(0, int((100.0 - progress) * 6))

    def set_progress(self, progress):
        return self.mutate(lambda value: self._set_progress_locked(progress))

    def _complete_locked(self, success):
        active = self.value.get('active_file')
        if active and active in self.value['files']:
            self.value['files'][active]['prints'] = {
                'last': {'success': bool(success), 'date': time.time()}
            }
        self.value['progress'] = 100.0 if success else self.value.get('progress')
        self.value['print_time_left'] = 0
        self.value['job_state'] = 'Operational' if success else 'Error'
        self.value['connection_state'] = 'Operational' if success else 'Error'
        self.value['fault'] = None if success else 'simulated_failure'

    def complete(self):
        return self.mutate(lambda value: self._complete_locked(True))

    def fail(self):
        return self.mutate(lambda value: self._complete_locked(False))


class FakeOctoPrintServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, state, api_key, control_key):
        ThreadingHTTPServer.__init__(self, address, FakeOctoPrintHandler)
        self.simulator_state = state
        self.api_key = api_key
        self.control_key = control_key


class FakeOctoPrintHandler(BaseHTTPRequestHandler):
    server_version = 'FakeOctoPrint/1.11.8-affetta'
    protocol_version = 'HTTP/1.1'

    @property
    def sim(self):
        return self.server.simulator_state

    def log_message(self, fmt, *args):
        print('[fake-octoprint] %s %s' % (self.address_string(), fmt % args), flush=True)

    def _send(self, status, body, content_type='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(int(status))
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json_body(self):
        length = int(self.headers.get('Content-Length', '0') or '0')
        raw = self.rfile.read(length)
        if not raw:
            return {}
        value = json.loads(raw.decode('utf-8'))
        if not isinstance(value, dict):
            raise ValueError('oggetto JSON richiesto')
        return value

    def _authorized(self):
        supplied = self.headers.get('X-Api-Key', '')
        if supplied != self.server.api_key:
            self._send(HTTPStatus.UNAUTHORIZED, {'error': 'invalid_api_key'})
            return False
        return True

    def _control_authorized(self):
        supplied = self.headers.get('X-Simulator-Key', '')
        if supplied != self.server.control_key:
            self._send(HTTPStatus.UNAUTHORIZED, {'error': 'invalid_control_key'})
            return False
        return True

    def _count(self):
        def increment(value):
            value['request_count'] = int(value.get('request_count') or 0) + 1
        self.sim.mutate(increment)

    def do_GET(self):
        self._count()
        path = urlsplit(self.path).path
        if path.startswith('/__simulator__/'):
            if not self._control_authorized():
                return
            if path == '/__simulator__/state':
                self._send(200, self.sim.snapshot())
                return
            self._send(404, {'error': 'not_found'})
            return
        if not self._authorized():
            return
        state = self.sim.snapshot()
        if path == '/api/version':
            self._send(200, {'api': '0.1', 'server': '1.11.8', 'text': 'OctoPrint 1.11.8'})
            return
        if path == '/api/connection':
            self._send(200, {
                'current': {
                    'state': state['connection_state'],
                    'port': 'FAKE',
                    'baudrate': 250000,
                    'printerProfile': '_default'
                },
                'options': {
                    'ports': ['FAKE'], 'baudrates': [250000],
                    'printerProfiles': [{'_id': '_default', 'name': 'Affetta Simulator'}]
                }
            })
            return
        if path == '/api/job':
            active = state.get('active_file')
            file_info = {'name': active, 'path': active, 'display': active} if active else {}
            self._send(200, {
                'state': state['job_state'],
                'job': {'file': file_info},
                'progress': {
                    'completion': state.get('progress'),
                    'printTime': state.get('print_time'),
                    'printTimeLeft': state.get('print_time_left')
                }
            })
            return
        if path == '/api/printer':
            self._send(200, self._printer_payload(state))
            return
        if path.startswith('/api/files/local/'):
            name = unquote(path[len('/api/files/local/'):])
            metadata = state.get('files', {}).get(name)
            if not metadata:
                self._send(404, {'error': 'file_not_found'})
                return
            self._send(200, metadata)
            return
        if path.startswith('/downloads/files/local/'):
            name = unquote(path[len('/downloads/files/local/'):])
            metadata = state.get('files', {}).get(name)
            file_path = self.sim.files_dir / name
            if not metadata or not file_path.exists():
                self._send(404, {'error': 'file_not_found'})
                return
            data = file_path.read_bytes()
            if state.get('corrupt_next_download'):
                self.sim.mutate(lambda value: value.__setitem__('corrupt_next_download', False))
                data = data + b'CORRUPTED'
            self._send(200, data, 'application/octet-stream')
            return
        self._send(404, {'error': 'not_found'})

    def _printer_payload(self, state):
        job_state = state.get('job_state')
        connection = state.get('connection_state')
        flags = {
            'operational': connection in ('Operational', 'Printing', 'Paused'),
            'ready': connection == 'Operational',
            'printing': job_state == 'Printing',
            'paused': job_state == 'Paused',
            'pausing': False,
            'resuming': False,
            'finishing': False,
            'cancelling': job_state == 'Cancelling',
            'error': connection == 'Error',
            'closedOrError': connection in ('Offline', 'Closed', 'Error')
        }
        return {
            'state': {'text': connection, 'flags': flags},
            'temperature': state.get('temperatures') or {}
        }

    def do_POST(self):
        self._count()
        path = urlsplit(self.path).path
        if path.startswith('/__simulator__/'):
            if not self._control_authorized():
                return
            try:
                payload = self._json_body()
                result = self._control(path, payload)
                self._send(200, result)
            except ValueError as error:
                self._send(400, {'error': str(error)})
            return
        if not self._authorized():
            return
        try:
            if path == '/api/connection':
                payload = self._json_body()
                command = payload.get('command')
                if command == 'connect':
                    def connect(value):
                        if value.get('connection_state') not in ('Printing', 'Paused'):
                            value['connection_state'] = 'Operational'
                            value['job_state'] = 'Operational'
                            value['fault'] = None
                    self._send(204, b'', 'application/json')
                    self.sim.mutate(connect)
                    return
                if command == 'disconnect':
                    self.sim.mutate(lambda value: value.update({'connection_state': 'Offline', 'job_state': 'Offline'}))
                    self._send(204, b'', 'application/json')
                    return
                self._send(400, {'error': 'unknown_connection_command'})
                return
            if path == '/api/files/local':
                self._upload_multipart()
                return
            if path.startswith('/api/files/local/'):
                name = unquote(path[len('/api/files/local/'):])
                payload = self._json_body()
                if payload.get('command') != 'select' or payload.get('print') is not True:
                    self._send(400, {'error': 'select_print_required'})
                    return
                state = self.sim.snapshot()
                if name not in state.get('files', {}):
                    self._send(404, {'error': 'file_not_found'})
                    return
                def start(value):
                    value['active_file'] = name
                    value['job_state'] = 'Printing'
                    value['connection_state'] = 'Printing'
                    value['progress'] = 0.0
                    value['print_time'] = 0
                    value['print_time_left'] = 600
                    value['fault'] = None
                    value['files'][name]['prints'] = value['files'][name].get('prints') or {}
                self.sim.mutate(start)
                self._send(204, b'', 'application/json')
                return
            if path == '/api/job':
                payload = self._json_body()
                command = payload.get('command')
                if command == 'pause':
                    action = payload.get('action')
                    if action == 'pause':
                        self.sim.mutate(lambda value: value.update({'job_state': 'Paused', 'connection_state': 'Paused'}))
                    elif action == 'resume':
                        self.sim.mutate(lambda value: value.update({'job_state': 'Printing', 'connection_state': 'Printing'}))
                    else:
                        raise ValueError('azione pausa non valida')
                    self._send(204, b'', 'application/json')
                    return
                if command == 'cancel':
                    def cancel(value):
                        active = value.get('active_file')
                        if active and active in value['files']:
                            value['files'][active]['prints'] = {'last': {'success': False, 'date': time.time()}}
                        value['job_state'] = 'Operational'
                        value['connection_state'] = 'Operational'
                        value['print_time_left'] = 0
                    self.sim.mutate(cancel)
                    self._send(204, b'', 'application/json')
                    return
                self._send(400, {'error': 'unknown_job_command'})
                return
            self._send(404, {'error': 'not_found'})
        except (ValueError, json.JSONDecodeError) as error:
            self._send(400, {'error': str(error)})

    def _upload_multipart(self):
        content_type = self.headers.get('Content-Type', '')
        boundary_match = re.search(r'boundary=([^;]+)', content_type, re.I)
        if not boundary_match:
            self._send(400, {'error': 'multipart_boundary_missing'})
            return
        boundary = boundary_match.group(1).strip().strip('"').encode('ascii')
        length = int(self.headers.get('Content-Length', '0') or '0')
        body = self.rfile.read(length)
        target = None
        filename = None
        marker = b'--' + boundary
        for part in body.split(marker):
            if b'name="file"' not in part:
                continue
            header_block, separator, payload = part.partition(b'\r\n\r\n')
            if not separator:
                continue
            match = FILE_RE.search(header_block.decode('utf-8', 'replace'))
            if not match:
                continue
            filename = os.path.basename(match.group(1))
            if payload.endswith(b'\r\n'):
                payload = payload[:-2]
            target = payload
            break
        if not filename or target is None:
            self._send(400, {'error': 'multipart_file_missing'})
            return
        file_path = self.sim.files_dir / filename
        file_path.write_bytes(target)
        metadata = {
            'name': filename,
            'path': filename,
            'display': filename,
            'origin': 'local',
            'size': len(target),
            'date': int(time.time()),
            'prints': {}
        }
        def add_file(value):
            value['files'][filename] = metadata
        self.sim.mutate(add_file)
        self._send(201, {'files': {'local': metadata}, 'done': True})

    def _control(self, path, payload):
        if path == '/__simulator__/reset':
            return self.sim.reset()
        if path == '/__simulator__/progress':
            if 'completion' not in payload:
                raise ValueError('completion obbligatorio')
            return self.sim.set_progress(payload['completion'])
        if path == '/__simulator__/complete':
            return self.sim.complete()
        if path == '/__simulator__/fail':
            return self.sim.fail()
        if path == '/__simulator__/offline':
            return self.sim.mutate(lambda value: value.update({'connection_state': 'Offline', 'job_state': 'Offline'}))
        if path == '/__simulator__/online':
            return self.sim.mutate(lambda value: value.update({'connection_state': 'Operational', 'job_state': 'Operational', 'fault': None}))
        if path == '/__simulator__/corrupt-next-download':
            return self.sim.mutate(lambda value: value.__setitem__('corrupt_next_download', True))
        if path == '/__simulator__/temperature':
            tool = float(payload.get('tool', 24.0))
            bed = float(payload.get('bed', 24.0))
            def temp(value):
                value['temperatures']['tool0']['actual'] = tool
                value['temperatures']['bed']['actual'] = bed
            return self.sim.mutate(temp)
        raise ValueError('endpoint controllo sconosciuto')



def main():
    parser = argparse.ArgumentParser(description='Fake OctoPrint per Affetta.')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5000)
    parser.add_argument('--api-key', default='AFFETTA_FAKE_OCTOPRINT_KEY')
    parser.add_argument('--control-key', default='AFFETTA_SIMULATOR_CONTROL')
    parser.add_argument('--data-dir', default='.fake-octoprint-data')
    parser.add_argument('--auto-progress', action='store_true')
    parser.add_argument('--auto-step', type=float, default=5.0)
    parser.add_argument('--auto-interval', type=float, default=1.0)
    args = parser.parse_args()

    state = SimulatorState(args.data_dir, args.auto_progress, args.auto_step, args.auto_interval)
    server = FakeOctoPrintServer((args.host, args.port), state, args.api_key, args.control_key)
    state.start_auto()

    stop_once = threading.Event()
    def stop(signum, frame):
        del signum, frame
        if stop_once.is_set():
            return
        stop_once.set()
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    print('Fake OctoPrint attivo su http://%s:%s' % (args.host, args.port), flush=True)
    print('API key: %s' % args.api_key, flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        state.stop_auto()
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
