from __future__ import annotations

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from .util import sha256_file


class CameraError(RuntimeError):
    pass


class Camera:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        self.width = int(config.get("width", 640))
        self.height = int(config.get("height", 480))
        self.quality = int(config.get("quality", 75))
        self.timeout_ms = int(config.get("timeout_ms", 1500))
        self.rotation = int(config.get("rotation", 0))
        self.command = self._resolve_command()

    def _resolve_command(self) -> str | None:
        configured = str(self.config.get("command", "auto"))
        if configured != "auto":
            return shutil.which(configured) or configured
        for candidate in ("rpicam-still", "libcamera-still"):
            found = shutil.which(candidate)
            if found:
                return found
        return None

    def available(self) -> bool:
        return bool(self.command)

    def capture(self, destination: Path) -> tuple[int, str]:
        if not self.command:
            raise CameraError("Nessun comando camera rpicam-still/libcamera-still disponibile")
        destination.parent.mkdir(parents=True, exist_ok=True)
        tmp = destination.with_name(f".{destination.name}.tmp")
        args = [
            self.command, "--nopreview", "--width", str(self.width), "--height", str(self.height),
            "--quality", str(self.quality), "--timeout", str(self.timeout_ms), "--output", str(tmp),
        ]
        if self.rotation in (90, 180, 270):
            args.extend(["--rotation", str(self.rotation)])
        result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=max(10, self.timeout_ms / 1000 + 8))
        if result.returncode != 0 or not tmp.exists() or tmp.stat().st_size < 512:
            try:
                tmp.unlink()
            except FileNotFoundError:
                pass
            error = result.stderr.decode("utf-8", "replace")[-1000:]
            raise CameraError(f"Acquisizione snapshot fallita: {error}")
        os.replace(tmp, destination)
        return destination.stat().st_size, sha256_file(destination)


class LiveSession:
    """Una sola sessione live breve. Mantiene soltanto l'ultimo frame JPEG."""

    def __init__(self, config: dict[str, Any]):
        self.config = config
        self._lock = threading.RLock()
        self._process: subprocess.Popen[bytes] | None = None
        self._reader: threading.Thread | None = None
        self._watchdog: threading.Thread | None = None
        self._frame: bytes | None = None
        self._expires_at = 0.0
        self._started_at = 0.0
        self._error: str | None = None

    def _command(self, duration_seconds: int) -> list[str]:
        binary = shutil.which("rpicam-vid") or shutil.which("libcamera-vid")
        if not binary:
            raise CameraError("Nessun comando rpicam-vid/libcamera-vid disponibile")
        width = max(160, min(int(self.config.get("width", 640)), 800))
        height = max(120, min(int(self.config.get("height", 480)), 600))
        fps = max(1, min(int(self.config.get("fps", 2)), 5))
        return [
            binary, "--nopreview", "--width", str(width), "--height", str(height),
            "--framerate", str(fps), "--codec", "mjpeg", "--timeout", str(duration_seconds * 1000),
            "--output", "-",
        ]

    def start(self, requested_seconds: int | None = None) -> dict[str, Any]:
        default = int(self.config.get("default_seconds", 45))
        maximum = min(120, int(self.config.get("max_seconds", 120)))
        duration = max(5, min(int(requested_seconds or default), maximum))
        with self._lock:
            self.stop()
            self._frame = None
            self._error = None
            self._started_at = time.time()
            self._expires_at = self._started_at + duration
            self._process = subprocess.Popen(self._command(duration), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0)
            self._reader = threading.Thread(target=self._read_frames, name="octobridge-live-reader", daemon=True)
            self._watchdog = threading.Thread(target=self._auto_stop, name="octobridge-live-watchdog", daemon=True)
            self._reader.start()
            self._watchdog.start()
            return self.status()

    def _read_frames(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        buffer = bytearray()
        try:
            while process.poll() is None:
                chunk = process.stdout.read(4096)
                if not chunk:
                    break
                buffer.extend(chunk)
                while True:
                    start = buffer.find(b"\xff\xd8")
                    if start < 0:
                        if len(buffer) > 1024 * 1024:
                            del buffer[:-2]
                        break
                    end = buffer.find(b"\xff\xd9", start + 2)
                    if end < 0:
                        if start > 0:
                            del buffer[:start]
                        break
                    frame = bytes(buffer[start:end + 2])
                    del buffer[:end + 2]
                    with self._lock:
                        self._frame = frame
        except Exception as error:  # pragma: no cover - dipende dall'hardware
            with self._lock:
                self._error = str(error)

    def _auto_stop(self) -> None:
        while True:
            with self._lock:
                remaining = self._expires_at - time.time()
                process = self._process
            if not process or process.poll() is not None:
                return
            if remaining <= 0:
                self.stop()
                return
            time.sleep(min(1.0, remaining))

    def stop(self) -> dict[str, Any]:
        with self._lock:
            process = self._process
            self._process = None
            self._expires_at = 0.0
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
        return self.status()

    def latest_frame(self) -> bytes | None:
        with self._lock:
            return self._frame

    def status(self) -> dict[str, Any]:
        with self._lock:
            active = bool(self._process and self._process.poll() is None and self._expires_at > time.time())
            return {
                "active": active,
                "started_at_epoch": int(self._started_at) if self._started_at else None,
                "expires_at_epoch": int(self._expires_at) if active else None,
                "seconds_remaining": max(0, int(self._expires_at - time.time())) if active else 0,
                "frame_available": self._frame is not None,
                "error": self._error,
            }
