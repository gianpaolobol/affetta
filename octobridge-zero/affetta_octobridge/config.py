from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class BridgeConfig:
    raw: dict[str, Any]
    path: Path

    @property
    def bind_host(self) -> str:
        return str(self.raw.get("bind_host", "0.0.0.0"))

    @property
    def bind_port(self) -> int:
        return int(self.raw.get("bind_port", 8792))

    @property
    def api_token(self) -> str:
        token = str(self.raw.get("api_token", "")).strip()
        if len(token) < 32:
            raise ValueError("api_token assente o troppo corto")
        return token

    @property
    def data_dir(self) -> Path:
        return Path(self.raw.get("data_dir", "/var/lib/affetta-octobridge")).expanduser()

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    @property
    def octoprint_url(self) -> str:
        return str(self.raw.get("octoprint_url", "http://127.0.0.1:5000")).rstrip("/")

    @property
    def octoprint_api_key(self) -> str:
        key = str(self.raw.get("octoprint_api_key", "")).strip()
        if not key:
            raise ValueError("octoprint_api_key mancante")
        return key

    @property
    def printer_profile_id(self) -> str:
        return str(self.raw.get("printer_profile_id", "")).strip()

    @property
    def serial_printing_enabled(self) -> bool:
        return bool(self.raw.get("serial_printing_enabled", False))

    @property
    def serial_port(self) -> str | None:
        value = self.raw.get("serial_port")
        return None if value in (None, "", "AUTO") else str(value)

    @property
    def baudrate(self) -> int | None:
        value = self.raw.get("baudrate")
        if value in (None, "", "AUTO", 0, "0"):
            return None
        return int(value)

    @property
    def poll_seconds(self) -> float:
        return max(2.0, float(self.raw.get("poll_seconds", 5.0)))

    @property
    def request_timeout_seconds(self) -> float:
        return max(2.0, float(self.raw.get("request_timeout_seconds", 20.0)))

    @property
    def serial_connect_timeout_seconds(self) -> float:
        return max(10.0, min(float(self.raw.get("serial_connect_timeout_seconds", 60.0)), 180.0))

    @property
    def verify_remote_sha256(self) -> bool:
        return bool(self.raw.get("verify_remote_sha256", True))

    @property
    def require_pre_print_snapshot(self) -> bool:
        return bool(self.raw.get("require_pre_print_snapshot", True))

    @property
    def camera(self) -> dict[str, Any]:
        return dict(self.raw.get("camera") or {})

    @property
    def live(self) -> dict[str, Any]:
        return dict(self.raw.get("live") or {})

    @property
    def retention_days_after_sync(self) -> int:
        return max(1, int(self.raw.get("retention_days_after_sync", 30)))

    @property
    def max_gcode_bytes(self) -> int:
        return max(1024 * 1024, int(self.raw.get("max_gcode_bytes", 2 * 1024 * 1024 * 1024)))


def load_config(path: str | Path | None = None) -> BridgeConfig:
    config_path = Path(path or os.environ.get("AFFETTA_OCTOBRIDGE_CONFIG", "/etc/affetta-octobridge/config.json"))
    with config_path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    if not isinstance(raw, dict):
        raise ValueError("configurazione non valida")
    return BridgeConfig(raw=raw, path=config_path)
