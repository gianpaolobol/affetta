import hashlib
import json
import tempfile
import threading
import unittest
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from affetta_octobridge.octoprint import OctoPrintClient


class FakeOctoHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    files = {}

    def log_message(self, *args):
        pass

    def send_bytes(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type",content_type)
        self.send_header("Content-Length",str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/files/local":
            self.send_bytes(404,b"", "text/plain")
            return
        length=int(self.headers["Content-Length"])
        raw=self.rfile.read(length)
        content_type=self.headers["Content-Type"]
        boundary=content_type.split("boundary=",1)[1].encode()
        header_end=raw.index(b"\r\n\r\n")+4
        suffix=b"\r\n--"+boundary+b"--\r\n"
        self.__class__.files["remote.gcode"]=raw[header_end:-len(suffix)]
        response=json.dumps({"files":{"local":{"path":"remote.gcode"}}}).encode()
        self.send_bytes(201,response,"application/json")

    def do_GET(self):
        if self.path == "/api/files/local/remote.gcode":
            response=json.dumps({"size":len(self.__class__.files["remote.gcode"])}).encode()
            self.send_bytes(200,response,"application/json")
            return
        if self.path == "/downloads/files/local/remote.gcode":
            self.send_bytes(200,self.__class__.files["remote.gcode"],"application/octet-stream")
            return
        self.send_bytes(404,b"", "text/plain")


class OctoPrintClientTests(unittest.TestCase):
    def test_multipart_upload_and_download_preserve_exact_bytes(self):
        server=ThreadingHTTPServer(("127.0.0.1",0),FakeOctoHandler)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                data=(b"G1 X123.456 Y78.9\n"*65536)+b";END\n"
                path=Path(tmp)/"source.gcode"
                path.write_bytes(data)
                client=OctoPrintClient(f"http://127.0.0.1:{server.server_address[1]}","key",timeout=3)
                response=client.upload_local(path,"source.gcode")
                remote=response["files"]["local"]["path"]
                self.assertEqual(client.file_metadata(remote)["size"],len(data))
                size,digest=client.download_sha256(remote)
                self.assertEqual(size,len(data))
                self.assertEqual(digest,hashlib.sha256(data).hexdigest())
                self.assertEqual(FakeOctoHandler.files[remote],data)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
