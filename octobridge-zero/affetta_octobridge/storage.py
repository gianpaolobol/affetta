from __future__ import annotations

import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .util import append_jsonl, atomic_write_json, iter_jsonl, read_json, utc_now, validate_job_id

TERMINAL_STATES = {"completed", "failed", "cancelled", "interrupted", "outcome_unknown"}
ACTIVE_STATES = {"starting", "printing", "paused", "cancel_requested"}


class JobStore:
    def __init__(self, jobs_dir: Path):
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def job_dir(self, job_id: str) -> Path:
        return self.jobs_dir / validate_job_id(job_id)

    def metadata_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "metadata.json"

    def events_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "events.jsonl"

    def gcode_path(self, job_id: str, filename: str) -> Path:
        return self.job_dir(job_id) / "gcode" / filename

    def create(self, metadata: dict[str, Any]) -> dict[str, Any]:
        job_id = validate_job_id(metadata["job_id"])
        with self._lock:
            path = self.metadata_path(job_id)
            if path.exists():
                existing = self.load(job_id)
                immutable = ("filename", "size_bytes", "sha256", "printer_profile_id")
                if all(existing.get(key) == metadata.get(key) for key in immutable):
                    return existing
                raise FileExistsError("job_id già esistente con metadati differenti")
            now = utc_now()
            value = {
                **metadata,
                "schema_version": "affetta.octobridge-job.v1",
                "release_channel": "experimental",
                "production_ready": False,
                "state": "created",
                "created_at": now,
                "updated_at": now,
                "event_sequence": 0,
                "sync": {"ack_event_sequence": 0, "ack_files": [], "fully_synced_at": None},
                "snapshots": {},
                "octoprint": {"remote_path": None, "verified_sha256": None},
                "last_observation": None,
            }
            self.job_dir(job_id).mkdir(parents=True, exist_ok=False)
            atomic_write_json(path, value)
            self.append_event(job_id, "job.created", {"filename": value["filename"]})
            return self.load(job_id)

    def load(self, job_id: str) -> dict[str, Any]:
        value = read_json(self.metadata_path(job_id))
        if not isinstance(value, dict):
            raise FileNotFoundError(job_id)
        return value

    def save(self, job_id: str, value: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            value = dict(value)
            value["updated_at"] = utc_now()
            atomic_write_json(self.metadata_path(job_id), value)
            return value

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self._lock:
            value = self.load(job_id)
            value.update(changes)
            return self.save(job_id, value)

    def set_state(self, job_id: str, state: str, reason: str | None = None, **extra: Any) -> dict[str, Any]:
        with self._lock:
            value = self.load(job_id)
            previous = value.get("state")
            value["state"] = state
            value.update(extra)
            self.save(job_id, value)
            if previous != state or reason:
                self.append_event(job_id, "job.state", {"from": previous, "to": state, "reason": reason})
            return self.load(job_id)

    def append_event(self, job_id: str, event_type: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            value = self.load(job_id)
            sequence = int(value.get("event_sequence", 0)) + 1
            event = {
                "schema_version": "affetta.octobridge-event.v1",
                "sequence": sequence,
                "timestamp": utc_now(),
                "type": event_type,
                "payload": payload or {},
            }
            append_jsonl(self.events_path(job_id), event)
            value["event_sequence"] = sequence
            sync = dict(value.get("sync") or {})
            sync["fully_synced_at"] = None
            value["sync"] = sync
            self.save(job_id, value)
            return event

    def events(self, job_id: str, after_sequence: int = 0) -> list[dict[str, Any]]:
        return [item for item in iter_jsonl(self.events_path(job_id)) if int(item.get("sequence", 0)) > after_sequence]

    def list_jobs(self) -> list[dict[str, Any]]:
        result = []
        for directory in sorted(self.jobs_dir.iterdir() if self.jobs_dir.exists() else []):
            if not directory.is_dir():
                continue
            value = read_json(directory / "metadata.json")
            if isinstance(value, dict):
                result.append(value)
        return result

    def nonterminal_jobs(self) -> list[dict[str, Any]]:
        return [job for job in self.list_jobs() if job.get("state") not in TERMINAL_STATES]

    def snapshot_path(self, job_id: str, filename: str) -> Path:
        return self.job_dir(job_id) / filename

    def register_snapshot(self, job_id: str, key: str, filename: str, sha256: str, size_bytes: int) -> None:
        with self._lock:
            value = self.load(job_id)
            snapshots = dict(value.get("snapshots") or {})
            snapshots[key] = {
                "filename": filename,
                "sha256": sha256,
                "size_bytes": size_bytes,
                "captured_at": utc_now(),
            }
            value["snapshots"] = snapshots
            self.save(job_id, value)
            self.append_event(job_id, "snapshot.captured", {"key": key, "filename": filename})

    def pending_sync(self) -> list[dict[str, Any]]:
        result = []
        for job in self.list_jobs():
            sync = job.get("sync") or {}
            ack_seq = int(sync.get("ack_event_sequence", 0))
            snapshots = job.get("snapshots") or {}
            ack_files = set(sync.get("ack_files") or [])
            pending_files = [meta["filename"] for meta in snapshots.values() if meta.get("filename") not in ack_files]
            if ack_seq < int(job.get("event_sequence", 0)) or pending_files or not sync.get("fully_synced_at"):
                result.append({
                    "job_id": job["job_id"],
                    "state": job.get("state"),
                    "event_sequence": job.get("event_sequence", 0),
                    "ack_event_sequence": ack_seq,
                    "pending_files": pending_files,
                    "updated_at": job.get("updated_at"),
                })
        return result

    def acknowledge_sync(self, job_id: str, event_sequence: int, files: list[str]) -> dict[str, Any]:
        with self._lock:
            value = self.load(job_id)
            sync = dict(value.get("sync") or {})
            sync["ack_event_sequence"] = min(max(int(event_sequence), int(sync.get("ack_event_sequence", 0))), int(value.get("event_sequence", 0)))
            known_files = {meta.get("filename") for meta in (value.get("snapshots") or {}).values()}
            ack_files = set(sync.get("ack_files") or [])
            ack_files.update(name for name in files if name in known_files)
            sync["ack_files"] = sorted(ack_files)
            all_events = sync["ack_event_sequence"] >= int(value.get("event_sequence", 0))
            all_files = known_files.issubset(ack_files)
            if all_events and all_files:
                sync["fully_synced_at"] = utc_now()
            else:
                sync["fully_synced_at"] = None
            value["sync"] = sync
            self.save(job_id, value)
            return self.load(job_id)

    def purge_synced_payloads(self, retention_days: int) -> list[str]:
        """Rimuove G-code e immagini già sincronizzati, conservando metadata ed eventi."""
        now = datetime.now(timezone.utc).timestamp()
        threshold = max(1, int(retention_days)) * 86400
        purged: list[str] = []
        with self._lock:
            for value in self.list_jobs():
                if value.get("state") not in TERMINAL_STATES:
                    continue
                sync = value.get("sync") or {}
                synced_at = sync.get("fully_synced_at")
                if not synced_at or value.get("local_payloads_purged_at"):
                    continue
                try:
                    synced_epoch = datetime.fromisoformat(str(synced_at).replace("Z", "+00:00")).timestamp()
                except ValueError:
                    continue
                if now - synced_epoch < threshold:
                    continue
                job_id = value["job_id"]
                for meta in (value.get("snapshots") or {}).values():
                    filename = meta.get("filename")
                    if filename:
                        try:
                            self.snapshot_path(job_id, filename).unlink()
                        except FileNotFoundError:
                            pass
                shutil.rmtree(self.job_dir(job_id) / "gcode", ignore_errors=True)
                value["local_payloads_purged_at"] = utc_now()
                self.save(job_id, value)
                purged.append(job_id)
        return purged

