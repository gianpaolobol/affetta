#!/usr/bin/env python3
from __future__ import print_function

import json
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'simulator'))
from fake_octoprint import FakeOctoPrintServer, SimulatorState  # noqa: E402


def free_port():
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class FakeOctoPrintTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.api_key = 'TEST_API_KEY_1234567890'
        self.control_key = 'TEST_CONTROL_KEY'
        self.port = free_port()
        self.state = SimulatorState(self.temp.name)
        self.server = FakeOctoPrintServer(('127.0.0.1', self.port), self.state, self.api_key, self.control_key)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:%d' % self.port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def request(self, method, path, body=None, control=False, content_type='application/json'):
        headers = {}
        if control:
            headers['X-Simulator-Key'] = self.control_key
        else:
            headers['X-Api-Key'] = self.api_key
        if body is not None and not isinstance(body, bytes):
            body = json.dumps(body).encode('utf-8')
        if body is not None:
            headers['Content-Type'] = content_type
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=3) as response:
            raw = response.read()
            if not raw:
                return response.status, None
            if 'application/json' in response.headers.get('Content-Type', ''):
                return response.status, json.loads(raw.decode('utf-8'))
            return response.status, raw

    def test_version_requires_api_key(self):
        req = urllib.request.Request(self.base + '/api/version')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=3)
        self.assertEqual(ctx.exception.code, 401)
        status, value = self.request('GET', '/api/version')
        self.assertEqual(status, 200)
        self.assertEqual(value['server'], '1.11.8')

    def test_upload_start_pause_resume_complete(self):
        boundary = '----TESTBOUNDARY'
        gcode = b'G28\nG1 X10 Y10\n'
        prefix = (
            '--%s\r\nContent-Disposition: form-data; name="file"; filename="cube.gcode"\r\n'
            'Content-Type: application/octet-stream\r\n\r\n' % boundary
        ).encode('ascii')
        body = prefix + gcode + ('\r\n--%s--\r\n' % boundary).encode('ascii')
        status, uploaded = self.request(
            'POST', '/api/files/local', body,
            content_type='multipart/form-data; boundary=' + boundary
        )
        self.assertEqual(status, 201)
        self.assertEqual(uploaded['files']['local']['size'], len(gcode))

        status, metadata = self.request('GET', '/api/files/local/cube.gcode')
        self.assertEqual(status, 200)
        self.assertEqual(metadata['size'], len(gcode))
        status, downloaded = self.request('GET', '/downloads/files/local/cube.gcode')
        self.assertEqual(downloaded, gcode)

        status, _ = self.request('POST', '/api/connection', {'command': 'connect'})
        self.assertEqual(status, 204)
        status, _ = self.request('POST', '/api/files/local/cube.gcode', {'command': 'select', 'print': True})
        self.assertEqual(status, 204)
        _, job = self.request('GET', '/api/job')
        self.assertEqual(job['state'], 'Printing')

        self.request('POST', '/api/job', {'command': 'pause', 'action': 'pause'})
        _, job = self.request('GET', '/api/job')
        self.assertEqual(job['state'], 'Paused')
        self.request('POST', '/api/job', {'command': 'pause', 'action': 'resume'})
        _, job = self.request('GET', '/api/job')
        self.assertEqual(job['state'], 'Printing')

        self.request('POST', '/__simulator__/progress', {'completion': 50}, control=True)
        _, job = self.request('GET', '/api/job')
        self.assertEqual(job['progress']['completion'], 50.0)
        self.request('POST', '/__simulator__/complete', {}, control=True)
        _, job = self.request('GET', '/api/job')
        self.assertEqual(job['state'], 'Operational')
        _, metadata = self.request('GET', '/api/files/local/cube.gcode')
        self.assertTrue(metadata['prints']['last']['success'])

    def test_persistent_state(self):
        self.state.set_progress(33)
        reloaded = SimulatorState(self.temp.name)
        self.assertEqual(reloaded.snapshot()['progress'], 33.0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
