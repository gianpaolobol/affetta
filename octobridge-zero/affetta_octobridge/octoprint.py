from __future__ import annotations

import hashlib
import http.client
import json
import mimetypes
import secrets
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, BinaryIO


class OctoPrintError(RuntimeError):
    def __init__(self, message: str, code: str = "octoprint_error", status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


class OctoPrintClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _request(self, method: str, path: str, body: bytes | BinaryIO | None = None,
                 headers: dict[str, str] | None = None) -> tuple[int, dict[str, str], bytes]:
        request_headers = {"Accept": "application/json", "X-Api-Key": self.api_key}
        request_headers.update(headers or {})
        url = self.base_url + path
        request = urllib.request.Request(url, data=body, method=method, headers=request_headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.status, dict(response.headers.items()), response.read()
        except urllib.error.HTTPError as error:
            payload = error.read(2048).decode("utf-8", "replace")
            code = "authentication_failed" if error.code in (401, 403) else "octoprint_protocol_error"
            raise OctoPrintError(f"OctoPrint HTTP {error.code}: {payload}", code=code, status=error.code) from error
        except urllib.error.URLError as error:
            raise OctoPrintError(f"OctoPrint non raggiungibile: {error.reason}", code="octoprint_unreachable") from error

    def json_request(self, method: str, path: str, payload: Any | None = None) -> Any:
        body = None
        headers: dict[str, str] = {}
        if payload is not None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            headers["Content-Type"] = "application/json"
        _, _, raw = self._request(method, path, body=body, headers=headers)
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise OctoPrintError("Risposta JSON OctoPrint non valida", code="octoprint_protocol_error") from error

    def version(self) -> dict[str, Any]:
        return self.json_request("GET", "/api/version") or {}

    def connection(self) -> dict[str, Any]:
        return self.json_request("GET", "/api/connection") or {}

    def state(self) -> dict[str, Any]:
        connection = self.connection()
        current_text = str(((connection.get("current") or {}).get("state") or "Offline"))
        try:
            job = self.json_request("GET", "/api/job") or {}
        except OctoPrintError as error:
            if error.status != 409:
                raise
            job = {}
        try:
            printer = self.json_request("GET", "/api/printer?exclude=sd") or {}
        except OctoPrintError as error:
            if error.status != 409:
                raise
            lowered = current_text.lower()
            printer = {
                "state": {
                    "text": current_text,
                    "flags": {
                        "operational": lowered in ("operational", "ready"),
                        "closedOrError": any(word in lowered for word in ("closed", "error", "offline")),
                    },
                },
                "temperature": {},
            }
        return {"job": job, "printer": printer, "connection": connection}

    def connect(self, port: str | None = None, baudrate: int | None = None, printer_profile: str | None = None) -> None:
        payload: dict[str, Any] = {"command": "connect", "save": True, "autoconnect": True}
        if port:
            payload["port"] = port
        if baudrate:
            payload["baudrate"] = baudrate
        if printer_profile:
            payload["printerProfile"] = printer_profile
        self.json_request("POST", "/api/connection", payload)

    def upload_local(self, path: Path, remote_name: str) -> dict[str, Any]:
        """Carica il file con multipart streaming senza copiarlo interamente in RAM."""
        boundary = "----AffettaOctoBridge" + secrets.token_hex(16)
        content_type = mimetypes.guess_type(remote_name)[0] or "application/octet-stream"
        prefix = (
            f"--{boundary}\r\n"
            f"Content-Disposition: form-data; name=\"file\"; filename=\"{remote_name}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        parsed = urllib.parse.urlsplit(self.base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise OctoPrintError("octoprint_url non valido", code="invalid_configuration")
        connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_cls(parsed.hostname, parsed.port, timeout=max(self.timeout, 900.0))
        request_path = (parsed.path.rstrip("/") if parsed.path else "") + "/api/files/local"
        content_length = len(prefix) + path.stat().st_size + len(suffix)
        try:
            connection.putrequest("POST", request_path)
            connection.putheader("Accept", "application/json")
            connection.putheader("X-Api-Key", self.api_key)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(content_length))
            connection.endheaders()
            connection.send(prefix)
            with path.open("rb") as handle:
                while True:
                    chunk = handle.read(256 * 1024)
                    if not chunk:
                        break
                    connection.send(chunk)
            connection.send(suffix)
            response = connection.getresponse()
            raw = response.read()
            if response.status < 200 or response.status >= 300:
                code = "authentication_failed" if response.status in (401, 403) else "octoprint_protocol_error"
                raise OctoPrintError(
                    f"OctoPrint HTTP {response.status}: {raw[:2048].decode('utf-8', 'replace')}",
                    code=code,
                    status=response.status,
                )
            if not raw:
                return {}
            try:
                value = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as error:
                raise OctoPrintError("Risposta JSON upload OctoPrint non valida", code="octoprint_protocol_error") from error
            return value if isinstance(value, dict) else {}
        except OSError as error:
            raise OctoPrintError(f"Upload OctoPrint fallito: {error}", code="octoprint_unreachable") from error
        finally:
            connection.close()

    def file_metadata(self, remote_path: str) -> dict[str, Any]:
        encoded = urllib.parse.quote(remote_path, safe="/")
        return self.json_request("GET", f"/api/files/local/{encoded}") or {}

    def download_sha256(self, remote_path: str, chunk_size: int = 256 * 1024) -> tuple[int, str]:
        encoded = urllib.parse.quote(remote_path, safe="/")
        request = urllib.request.Request(
            self.base_url + f"/downloads/files/local/{encoded}",
            method="GET",
            headers={"X-Api-Key": self.api_key, "Accept": "application/octet-stream"},
        )
        digest = hashlib.sha256()
        total = 0
        try:
            with urllib.request.urlopen(request, timeout=max(self.timeout, 900.0)) as response:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    total += len(chunk)
                    digest.update(chunk)
        except urllib.error.HTTPError as error:
            raise OctoPrintError(f"Verifica download OctoPrint HTTP {error.code}", status=error.code) from error
        except urllib.error.URLError as error:
            raise OctoPrintError(f"Verifica download OctoPrint fallita: {error.reason}") from error
        return total, digest.hexdigest()

    def start(self, remote_path: str) -> None:
        encoded = urllib.parse.quote(remote_path, safe="/")
        self.json_request("POST", f"/api/files/local/{encoded}", {"command": "select", "print": True})

    def pause(self) -> None:
        self.json_request("POST", "/api/job", {"command": "pause", "action": "pause"})

    def resume(self) -> None:
        self.json_request("POST", "/api/job", {"command": "pause", "action": "resume"})

    def cancel(self) -> None:
        self.json_request("POST", "/api/job", {"command": "cancel"})
