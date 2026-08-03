from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterable

JOB_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")
SAFE_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,191}$")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def epoch_seconds() -> int:
    return int(time.time())


def validate_job_id(value: str) -> str:
    value = str(value or "").strip()
    if not JOB_ID_RE.fullmatch(value):
        raise ValueError("job_id non valido")
    return value


def safe_filename(value: str, suffix: str | None = None) -> str:
    name = Path(str(value or "")).name.strip()
    if not SAFE_FILE_RE.fullmatch(name):
        raise ValueError("nome file non valido")
    if suffix and not name.lower().endswith(suffix.lower()):
        raise ValueError(f"il file deve terminare con {suffix}")
    return name


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def read_json(path: Path, default: Any = None) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


def append_jsonl(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(encoded + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(value, dict):
                    yield value
    except FileNotFoundError:
        return


def sha256_file(path: Path, chunk_size: int = 256 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def copy_and_hash(source: BinaryIO, destination: Path, expected_size: int, expected_sha256: str,
                  chunk_size: int = 256 * 1024) -> tuple[int, str]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=str(destination.parent))
    total = 0
    digest = hashlib.sha256()
    try:
        with os.fdopen(fd, "wb") as output:
            while True:
                chunk = source.read(chunk_size)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_size:
                    raise ValueError("dimensione ricevuta superiore a quella dichiarata")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        actual_hash = digest.hexdigest()
        if total != expected_size:
            raise ValueError(f"dimensione non valida: ricevuti {total}, attesi {expected_size}")
        if actual_hash.lower() != expected_sha256.lower():
            raise ValueError("SHA-256 del G-code non corrispondente")
        os.replace(tmp_name, destination)
        return total, actual_hash
    finally:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass


def clamp_number(value: Any, minimum: float, maximum: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(minimum, min(maximum, number))
