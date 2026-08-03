import hashlib
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from affetta_octobridge.api import BridgeHTTPServer, Handler
from affetta_octobridge.config import BridgeConfig
from affetta_octobridge.jobs import JobManager
from affetta_octobridge.storage import JobStore


class FakeCamera:
    def capture(self, destination):
        data = b"\xff\xd8api-test\xff\xd9"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        return len(data), hashlib.sha256(data).hexdigest()


class FakeOctoPrint:
    def state(self):
        return {
            "job":{"job":{"file":{}},"progress":{}},
            "printer":{"state":{"text":"Operational","flags":{"operational":True}},"temperature":{}},
            "connection":{"current":{"state":"Operational"}}
        }


class FakeLive:
    def status(self): return {"active":False}
    def start(self, seconds=None): return {"active":True,"seconds_remaining":seconds or 45}
    def stop(self): return {"active":False}
    def latest_frame(self): return None


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        raw = {
            "api_token":"t"*40,"data_dir":str(Path(self.tmp.name)/"data"),
            "printer_profile_id":"anycubic-predator","serial_printing_enabled":False,
            "octoprint_api_key":"key","verify_remote_sha256":True,"camera":{},"live":{}
        }
        cfg_path = Path(self.tmp.name)/"config.json"
        cfg_path.write_text(json.dumps(raw))
        config = BridgeConfig(raw, cfg_path)
        self.store = JobStore(config.jobs_dir)
        manager = JobManager(config, self.store, FakeOctoPrint(), FakeCamera(), live=FakeLive())
        self.server = BridgeHTTPServer(("127.0.0.1",0), Handler, manager=manager, store=self.store, token="t"*40, catalog=[], live=FakeLive())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.tmp.cleanup()

    def request(self, method, path, body=None, content_type="application/json", auth=True):
        headers={"Content-Type":content_type}
        if auth: headers["Authorization"]="Bearer "+"t"*40
        req=urllib.request.Request(self.base+path,data=body,method=method,headers=headers)
        with urllib.request.urlopen(req,timeout=3) as response:
            return response.status,json.loads(response.read().decode())

    def test_exact_content_length_finishes_without_waiting_for_eof(self):
        data=b"G28\nG1 X1 Y1\n"
        digest=hashlib.sha256(data).hexdigest()
        payload={"job_id":"api-job","filename":"api.gcode","size_bytes":len(data),"sha256":digest,"printer_profile_id":"anycubic-predator"}
        status,_=self.request("POST","/v1/jobs",json.dumps(payload).encode())
        self.assertEqual(status,201)
        status,job=self.request("PUT","/v1/jobs/api-job/gcode",data,"application/octet-stream")
        self.assertEqual(status,200)
        self.assertEqual(job["state"],"staged")
        self.assertEqual(self.store.gcode_path("api-job","api.gcode").read_bytes(),data)

    def test_authentication_is_required_except_health(self):
        status,_=self.request("GET","/health",body=None,auth=False)
        self.assertEqual(status,200)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("GET","/v1/status",body=None,auth=False)
        self.assertEqual(caught.exception.code,401)


if __name__ == "__main__":
    unittest.main()
