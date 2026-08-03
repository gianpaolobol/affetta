from __future__ import annotations

import hmac
import json
import mimetypes
import re
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .camera import LiveSession
from .jobs import JobConflict, JobManager
from .storage import JobStore
from .util import safe_filename, validate_job_id

JOB_PATH = re.compile(r"^/v1/jobs/([A-Za-z0-9][A-Za-z0-9._-]{0,95})(?:/(.*))?$")


class LimitedReader:
    def __init__(self, raw: Any, remaining: int):
        self.raw = raw
        self.remaining = remaining

    def read(self, size: int = -1) -> bytes:
        if self.remaining <= 0:
            return b""
        if size < 0 or size > self.remaining:
            size = self.remaining
        data = self.raw.read(size)
        self.remaining -= len(data)
        return data


class BridgeHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], handler: type[BaseHTTPRequestHandler], *, manager: JobManager,
                 store: JobStore, token: str, catalog: list[dict[str, Any]], live: LiveSession):
        super().__init__(address, handler)
        self.manager = manager
        self.store = store
        self.token = token
        self.catalog = catalog
        self.live = live


class Handler(BaseHTTPRequestHandler):
    server_version = "AffettaOctoBridge/0.1-experimental"
    protocol_version = "HTTP/1.1"

    @property
    def bridge(self) -> BridgeHTTPServer:
        return self.server  # type: ignore[return-value]

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[octobridge-api] {self.address_string()} {fmt % args}", flush=True)

    def _authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        expected = "Bearer " + self.bridge.token
        return hmac.compare_digest(supplied, expected)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, value: Any) -> None:
        self._send(status, json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message}})

    def _read_json(self, maximum: int = 1024 * 1024) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > maximum:
            raise ValueError("corpo richiesta troppo grande")
        raw = self.rfile.read(length)
        value = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(value, dict):
            raise ValueError("oggetto JSON richiesto")
        return value

    def _guard(self) -> bool:
        if self.path == "/health":
            return True
        if not self._authorized():
            self._error(HTTPStatus.UNAUTHORIZED, "unauthorized", "Bearer token mancante o non valido")
            return False
        return True

    def do_GET(self) -> None:
        if not self._guard():
            return
        try:
            path, _, query = self.path.partition("?")
            if path == "/health":
                self._json(200, {"ok": True, "release_channel": "experimental", "production_ready": False})
                return
            if path == "/v1/status":
                self._json(200, self.bridge.manager.bridge_status())
                return
            if path == "/v1/printers":
                self._json(200, {"printers": self.bridge.catalog})
                return
            if path == "/v1/sync/pending":
                self._json(200, {"jobs": self.bridge.store.pending_sync()})
                return
            if path == "/v1/live/status":
                self._json(200, self.bridge.live.status())
                return
            if path == "/v1/live/frame.jpg":
                frame = self.bridge.live.latest_frame()
                if not frame:
                    self._error(404, "frame_unavailable", "nessun frame live disponibile")
                else:
                    self._send(200, frame, "image/jpeg")
                return
            match = JOB_PATH.match(path)
            if match:
                job_id, remainder = match.groups()
                job = self.bridge.store.load(job_id)
                if not remainder:
                    self._json(200, job)
                    return
                if remainder == "events":
                    after = 0
                    for item in query.split("&"):
                        if item.startswith("after="):
                            after = int(item.split("=", 1)[1])
                    self._json(200, {"events": self.bridge.store.events(job_id, after)})
                    return
                if remainder.startswith("files/"):
                    filename = safe_filename(remainder.split("/", 1)[1])
                    allowed = {meta.get("filename") for meta in (job.get("snapshots") or {}).values()}
                    if filename not in allowed:
                        self._error(404, "file_not_registered", "file non registrato per il job")
                        return
                    file_path = self.bridge.store.snapshot_path(job_id, filename)
                    if not file_path.exists():
                        self._error(404, "file_missing", "file non presente")
                        return
                    body = file_path.read_bytes()
                    self._send(200, body, mimetypes.guess_type(filename)[0] or "application/octet-stream")
                    return
            self._error(404, "not_found", "endpoint non trovato")
        except FileNotFoundError:
            self._error(404, "job_not_found", "job non trovato")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, "invalid_request", str(error))
        except Exception as error:
            self._error(500, "internal_error", str(error))

    def do_POST(self) -> None:
        if not self._guard():
            return
        try:
            path = self.path.partition("?")[0]
            if path == "/v1/jobs":
                self._json(201, self.bridge.manager.create_job(self._read_json()))
                return
            if path == "/v1/live/start":
                blocked = [job for job in self.bridge.store.nonterminal_jobs() if job.get("state") in ("receiving", "transferring", "starting")]
                if blocked:
                    self._error(409, "live_temporarily_blocked", f"live non disponibile durante lo stato {blocked[0].get('state')}")
                    return
                payload = self._read_json()
                self._json(200, self.bridge.live.start(payload.get("duration_seconds")))
                return
            if path == "/v1/live/stop":
                self._json(200, self.bridge.live.stop())
                return
            match = JOB_PATH.match(path)
            if match:
                job_id, action = match.groups()
                if action == "transfer":
                    self._json(200, self.bridge.manager.transfer_to_octoprint(job_id))
                    return
                if action == "start":
                    self._json(200, self.bridge.manager.start_job(job_id))
                    return
                if action == "cancel":
                    self._json(200, self.bridge.manager.cancel_job(job_id))
                    return
                if action == "pause":
                    self._json(200, self.bridge.manager.pause_job(job_id))
                    return
                if action == "resume":
                    self._json(200, self.bridge.manager.resume_job(job_id))
                    return
                if action == "sync-ack":
                    payload = self._read_json()
                    self._json(200, self.bridge.store.acknowledge_sync(
                        job_id, int(payload.get("event_sequence", 0)), list(payload.get("files") or [])
                    ))
                    return
            self._error(404, "not_found", "endpoint non trovato")
        except FileExistsError as error:
            self._error(409, "job_exists", str(error))
        except JobConflict as error:
            self._error(409, "job_conflict", str(error))
        except FileNotFoundError:
            self._error(404, "job_not_found", "job non trovato")
        except (ValueError, json.JSONDecodeError) as error:
            self._error(400, "invalid_request", str(error))
        except Exception as error:
            self._error(502, getattr(error, "code", "bridge_operation_failed"), str(error))

    def do_PUT(self) -> None:
        if not self._guard():
            return
        try:
            path = self.path.partition("?")[0]
            match = JOB_PATH.match(path)
            if match and match.group(2) == "gcode":
                length_header = self.headers.get("Content-Length")
                if not length_header:
                    self._error(411, "length_required", "Content-Length obbligatorio")
                    return
                length = int(length_header)
                job = self.bridge.store.load(match.group(1))
                if length > int(job["size_bytes"]):
                    self._error(413, "payload_too_large", "G-code superiore alla dimensione dichiarata")
                    return
                self._json(200, self.bridge.manager.receive_gcode(match.group(1), LimitedReader(self.rfile, length), length))
                return
            self._error(404, "not_found", "endpoint non trovato")
        except JobConflict as error:
            self._error(409, "job_conflict", str(error))
        except FileNotFoundError:
            self._error(404, "job_not_found", "job non trovato")
        except ValueError as error:
            self._error(400, "invalid_gcode", str(error))
        except Exception as error:
            self._error(500, "receive_failed", str(error))


def serve(manager: JobManager, store: JobStore, token: str, catalog: list[dict[str, Any]], live: LiveSession,
          host: str, port: int) -> None:
    server = BridgeHTTPServer((host, port), Handler, manager=manager, store=store, token=token, catalog=catalog, live=live)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        live.stop()
        manager.stop_monitor()
        server.server_close()
