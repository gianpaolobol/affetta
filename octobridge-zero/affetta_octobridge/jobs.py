from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from .camera import Camera, CameraError
from .config import BridgeConfig
from .octoprint import OctoPrintClient, OctoPrintError
from .storage import ACTIVE_STATES, TERMINAL_STATES, JobStore
from .util import clamp_number, copy_and_hash, safe_filename, sha256_file, utc_now, validate_job_id

SNAPSHOT_PLAN = (
    (25.0, "progress_25", "01_progress_25.jpg"),
    (50.0, "progress_50", "02_progress_50.jpg"),
    (75.0, "progress_75", "03_progress_75.jpg"),
)
TERMINAL_SNAPSHOTS = {
    "completed": ("completed", "04_completed.jpg"),
    "failed": ("failed", "04_failed.jpg"),
    "cancelled": ("cancelled", "04_cancelled.jpg"),
    "interrupted": ("interrupted", "04_interrupted.jpg"),
}


class JobConflict(RuntimeError):
    pass


class JobManager:
    def __init__(self, config: BridgeConfig, store: JobStore, octoprint: OctoPrintClient, camera: Camera, live: Any | None = None):
        self.config = config
        self.store = store
        self.octoprint = octoprint
        self.camera = camera
        self.live = live
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._monitor = threading.Thread(target=self._monitor_loop, name="octobridge-monitor", daemon=True)
        self._last_bridge_error: str | None = None

    def start_monitor(self) -> None:
        self.reconcile_startup()
        if not self._monitor.is_alive():
            self._monitor.start()

    def stop_monitor(self) -> None:
        self._stop.set()
        if self._monitor.is_alive():
            self._monitor.join(timeout=5)

    def create_job(self, payload: dict[str, Any]) -> dict[str, Any]:
        job_id = validate_job_id(payload.get("job_id"))
        filename = safe_filename(payload.get("filename"), suffix=".gcode")
        size = int(payload.get("size_bytes", -1))
        sha256 = str(payload.get("sha256", "")).lower().strip()
        profile_id = str(payload.get("printer_profile_id", "")).strip()
        if size < 1 or size > self.config.max_gcode_bytes:
            raise ValueError("size_bytes non valido o superiore al limite")
        if len(sha256) != 64 or any(char not in "0123456789abcdef" for char in sha256):
            raise ValueError("sha256 non valido")
        if not profile_id:
            raise ValueError("printer_profile_id mancante")
        if self.config.printer_profile_id == "UNCONFIGURED":
            raise ValueError("OctoBridge non configurato: selezionare e collaudare una stampante prima di inviare lavori")
        if self.config.printer_profile_id and profile_id != self.config.printer_profile_id:
            raise ValueError("profilo non corrispondente al bridge configurato")
        metadata = {
            "job_id": job_id,
            "filename": filename,
            "size_bytes": size,
            "sha256": sha256,
            "printer_profile_id": profile_id,
            "affetta_job_id": str(payload.get("affetta_job_id") or job_id),
            "display_name": str(payload.get("display_name") or filename)[:200],
            "source": dict(payload.get("source") or {}),
        }
        return self.store.create(metadata)

    def receive_gcode(self, job_id: str, stream: Any, content_length: int | None = None) -> dict[str, Any]:
        with self._lock:
            active = [item for item in self.store.nonterminal_jobs() if item.get("state") in ACTIVE_STATES and item.get("job_id") != job_id]
            if active:
                raise JobConflict(f"ricezione G-code bloccata durante la stampa {active[0]['job_id']} per proteggere la comunicazione seriale")
            job = self.store.load(job_id)
            if job.get("state") not in ("created", "receiving", "staged"):
                raise JobConflict(f"G-code non ricevibile nello stato {job.get('state')}")
            if content_length is not None and int(content_length) != int(job["size_bytes"]):
                raise ValueError("Content-Length differente da size_bytes")
            self.store.set_state(job_id, "receiving")
            destination = self.store.gcode_path(job_id, job["filename"])
            try:
                size, digest = copy_and_hash(stream, destination, int(job["size_bytes"]), job["sha256"])
            except Exception as error:
                self.store.set_state(job_id, "created", reason="ricezione G-code fallita")
                self.store.append_event(job_id, "gcode.rejected", {"error": str(error)})
                raise
            self.store.set_state(job_id, "staged", staged_path=str(destination), staged_at=utc_now())
            self.store.append_event(job_id, "gcode.staged", {"size_bytes": size, "sha256": digest})
            return self.store.load(job_id)

    def transfer_to_octoprint(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            active = [item for item in self.store.nonterminal_jobs() if item.get("state") in ACTIVE_STATES and item.get("job_id") != job_id]
            if active:
                raise JobConflict(f"trasferimento OctoPrint bloccato durante la stampa {active[0]['job_id']} per proteggere la comunicazione seriale")
            job = self.store.load(job_id)
            if job.get("state") not in ("staged", "transferring", "transferred"):
                raise JobConflict(f"trasferimento non consentito nello stato {job.get('state')}")
            path = self.store.gcode_path(job_id, job["filename"])
            if not path.exists():
                raise FileNotFoundError(path)
            local_hash = sha256_file(path)
            if path.stat().st_size != int(job["size_bytes"]) or local_hash != job["sha256"]:
                self.store.set_state(job_id, "failed", reason="G-code locale alterato dopo la ricezione")
                raise ValueError("G-code locale non integro")
            self.store.set_state(job_id, "transferring")
            remote_name = f"affetta_{job_id}_{job['filename']}"
            try:
                response = self.octoprint.upload_local(path, remote_name)
                remote_path = (((response or {}).get("files") or {}).get("local") or {}).get("path") or remote_name
                metadata = self.octoprint.file_metadata(remote_path)
                remote_size = int(metadata.get("size", -1))
                if remote_size != int(job["size_bytes"]):
                    raise OctoPrintError(
                        f"dimensione remota OctoPrint {remote_size}, attesa {job['size_bytes']}",
                        code="remote_integrity_mismatch",
                    )
                verified_hash = None
                if self.config.verify_remote_sha256:
                    verified_size, verified_hash = self.octoprint.download_sha256(remote_path)
                    if verified_size != int(job["size_bytes"]) or verified_hash != job["sha256"]:
                        raise OctoPrintError(
                            "verifica SHA-256 del file memorizzato da OctoPrint fallita",
                            code="remote_integrity_mismatch",
                        )
            except Exception as error:
                self.store.set_state(job_id, "staged", reason="trasferimento OctoPrint fallito")
                self.store.append_event(job_id, "octoprint.transfer_failed", {"error": str(error)})
                raise
            octo = dict(job.get("octoprint") or {})
            octo.update({"remote_path": remote_path, "verified_sha256": verified_hash, "uploaded_at": utc_now()})
            self.store.set_state(job_id, "transferred", octoprint=octo, transferred_at=utc_now())
            self.store.append_event(job_id, "octoprint.transferred", {
                "remote_path": remote_path,
                "size_bytes": remote_size,
                "sha256_verified": bool(verified_hash),
            })
            return self.store.load(job_id)

    def _capture(self, job_id: str, key: str, filename: str, required: bool = False) -> bool:
        job = self.store.load(job_id)
        if key in (job.get("snapshots") or {}):
            return True
        if self.live is not None and self.live.status().get("active"):
            self.live.stop()
            self.store.append_event(job_id, "live.stopped_for_snapshot", {"snapshot_key": key})
        destination = self.store.snapshot_path(job_id, filename)
        try:
            size, digest = self.camera.capture(destination)
            self.store.register_snapshot(job_id, key, filename, digest, size)
            return True
        except CameraError as error:
            self.store.append_event(job_id, "snapshot.failed", {"key": key, "filename": filename, "error": str(error)})
            if required:
                raise
            return False

    def _wait_for_serial_connection(self) -> None:
        deadline = time.monotonic() + self.config.serial_connect_timeout_seconds
        last_state = "sconosciuto"
        while time.monotonic() < deadline:
            connection = self.octoprint.connection()
            last_state = str(((connection.get("current") or {}).get("state") or "sconosciuto"))
            lowered = last_state.lower()
            if lowered in ("operational", "ready") or "printing" in lowered or "paused" in lowered:
                return
            if "error" in lowered:
                raise OctoPrintError(f"Connessione seriale OctoPrint in errore: {last_state}")
            time.sleep(1.0)
        raise OctoPrintError(f"Connessione seriale non pronta entro il timeout: {last_state}", code="serial_connection_timeout")

    def start_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            active = [job for job in self.store.nonterminal_jobs() if job.get("state") in ACTIVE_STATES and job.get("job_id") != job_id]
            if active:
                raise JobConflict(f"bridge occupato dal job {active[0]['job_id']}")
            job = self.store.load(job_id)
            if not self.config.serial_printing_enabled:
                raise JobConflict("stampa seriale sperimentale non abilitata nella configurazione OctoBridge")
            if job.get("state") != "transferred":
                raise JobConflict("il job deve essere trasferito e verificato prima dell'avvio")
            remote_path = (job.get("octoprint") or {}).get("remote_path")
            if not remote_path:
                raise JobConflict("remote_path OctoPrint mancante")
            if self.config.require_pre_print_snapshot:
                self._capture(job_id, "pre_print", "00_pre_print.jpg", required=True)
            else:
                self._capture(job_id, "pre_print", "00_pre_print.jpg", required=False)
            self.store.set_state(job_id, "starting", start_requested_at=utc_now())
            try:
                self.octoprint.connect(self.config.serial_port, self.config.baudrate, None)
                self._wait_for_serial_connection()
                self.octoprint.start(remote_path)
            except Exception as error:
                self.store.set_state(job_id, "transferred", reason="avvio OctoPrint fallito")
                self.store.append_event(job_id, "octoprint.start_failed", {"error": str(error)})
                raise
            self.store.append_event(job_id, "octoprint.start_requested", {"remote_path": remote_path})
            return self.store.load(job_id)

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            job = self.store.load(job_id)
            previous_state = job.get("state")
            if previous_state not in ("starting", "printing", "paused", "cancel_requested"):
                raise JobConflict("annullamento non consentito nello stato corrente")
            if previous_state != "cancel_requested":
                self.store.set_state(job_id, "cancel_requested", cancel_requested_at=utc_now())
                self.store.append_event(job_id, "octoprint.cancel_requested", {})
            try:
                self.octoprint.cancel()
            except Exception as error:
                self.store.append_event(job_id, "octoprint.cancel_request_failed", {
                    "error": str(error),
                    "state_retained": "cancel_requested",
                })
                raise
            # Conferma subito quando il controller Ã¨ giÃ  tornato idle.
            # Con un controller ancora in transizione, poll_once conserva
            # cancel_requested e il monitor completerÃ  la riconciliazione.
            self.poll_once()
            return self.store.load(job_id)

    def pause_job(self, job_id: str) -> dict[str, Any]:
        job = self.store.load(job_id)
        if job.get("state") != "printing":
            raise JobConflict("pausa consentita solo durante la stampa")
        self.octoprint.pause()
        return job

    def resume_job(self, job_id: str) -> dict[str, Any]:
        job = self.store.load(job_id)
        if job.get("state") != "paused":
            raise JobConflict("ripresa consentita solo da pausa")
        self.octoprint.resume()
        return job

    @staticmethod
    def normalize_observation(raw: dict[str, Any]) -> dict[str, Any]:
        job = raw.get("job") or {}
        printer = raw.get("printer") or {}
        connection = raw.get("connection") or {}
        state = printer.get("state") or {}
        flags = state.get("flags") or {}
        progress = job.get("progress") or {}
        file = (job.get("job") or {}).get("file") or {}
        completion = clamp_number(progress.get("completion"), 0, 100)
        has_job = bool(file.get("path") or file.get("name") or file.get("display")) or str(job.get("state") or "").lower() in ("printing", "pausing", "paused", "cancelling")
        if flags.get("error"):
            machine, job_state = "error", ("failed" if has_job else "none")
        elif flags.get("closedOrError"):
            machine, job_state = "error", ("interrupted" if has_job else "none")
        elif flags.get("cancelling"):
            machine, job_state = "printing", "cancel_requested"
        elif flags.get("paused") or flags.get("pausing"):
            machine, job_state = "paused", "paused"
        elif flags.get("printing") or flags.get("resuming") or flags.get("finishing"):
            machine, job_state = "printing", "printing"
        elif flags.get("operational") or flags.get("ready"):
            machine, job_state = "ready", "none"
        else:
            machine, job_state = "offline", "none"
        temperatures = {}
        for key, value in (printer.get("temperature") or {}).items():
            if isinstance(value, dict):
                temperatures[key] = {
                    "actual": value.get("actual"), "target": value.get("target"), "offset": value.get("offset")
                }
        return {
            "observed_at": utc_now(),
            "connection_status": "disconnected" if machine == "offline" or flags.get("closedOrError") else "connected",
            "machine_status": machine,
            "job_status": job_state,
            "progress_percent": completion,
            "phase": state.get("text") or job.get("state"),
            "elapsed_seconds": progress.get("printTime"),
            "remaining_seconds": progress.get("printTimeLeft"),
            "active_file": file.get("path") or file.get("name") or file.get("display"),
            "temperatures": temperatures,
            "server_dependency": "device_autonomous" if job_state in ("printing", "paused", "cancel_requested", "failed", "interrupted") else "not_applicable",
            "raw": {
                "flags": flags,
                "job_state": job.get("state"),
                "connection_current": connection.get("current"),
            },
        }

    def bridge_status(self) -> dict[str, Any]:
        active = None
        for job in self.store.nonterminal_jobs():
            if job.get("state") in ACTIVE_STATES:
                active = job
                break
        try:
            raw = self.octoprint.state()
            observation = self.normalize_observation(raw)
            self._last_bridge_error = None
        except Exception as error:
            observation = {
                "observed_at": utc_now(), "connection_status": "unreachable", "machine_status": "offline",
                "job_status": active.get("state") if active else "none", "progress_percent": None,
                "phase": "OctoPrint non raggiungibile", "elapsed_seconds": None, "remaining_seconds": None,
                "active_file": None, "temperatures": {}, "server_dependency": "device_autonomous" if active else "not_applicable",
                "error": {"code": getattr(error, "code", "octoprint_unreachable"), "message": str(error), "retryable": True},
                "raw": {},
            }
            self._last_bridge_error = str(error)
        return {
            "schema_version": "affetta.octobridge-status.v1",
            "release_channel": "experimental",
            "production_ready": False,
            "bridge_id": self.config.raw.get("bridge_id"),
            "printer_profile_id": self.config.printer_profile_id,
            "serial_printing_enabled": self.config.serial_printing_enabled,
            "active_job_id": active.get("job_id") if active else None,
            "printer_snapshot": observation,
            "pending_sync_count": len(self.store.pending_sync()),
        }

    def reconcile_startup(self) -> None:
        candidates = self.store.nonterminal_jobs()
        if not candidates:
            return
        try:
            raw = self.octoprint.state()
            observation = self.normalize_observation(raw)
        except Exception as error:
            for job in candidates:
                self.store.append_event(job["job_id"], "reconcile.deferred", {"error": str(error)})
            return
        active_file = observation.get("active_file")
        for job in candidates:
            remote = (job.get("octoprint") or {}).get("remote_path")
            if remote and active_file and Path(str(active_file)).name == Path(str(remote)).name and observation["job_status"] in ("printing", "paused", "cancel_requested"):
                self.store.set_state(job["job_id"], observation["job_status"], reason="riconciliato con OctoPrint alla riaccensione")
                self.store.append_event(job["job_id"], "reconcile.active", observation)
            elif job.get("state") == "cancel_requested" and observation["job_status"] == "none":
                self._finalize(job["job_id"], "cancelled", "annullamento già richiesto e stampa non più attiva alla riconciliazione")
            elif job.get("state") in ("printing", "paused", "starting", "cancel_requested"):
                outcome = self._explicit_terminal_from_file(job, observation)
                if outcome:
                    self._finalize(job["job_id"], outcome, "esito esplicito rilevato alla riconciliazione")
                else:
                    self.store.set_state(job["job_id"], "outcome_unknown", reason="OctoPrint non espone dati sufficienti per determinare l'esito")
                    self.store.append_event(job["job_id"], "reconcile.outcome_unknown", observation)

    def _explicit_terminal_from_file(self, job: dict[str, Any], observation: dict[str, Any]) -> str | None:
        remote = (job.get("octoprint") or {}).get("remote_path")
        if not remote:
            return None
        try:
            metadata = self.octoprint.file_metadata(remote)
        except Exception:
            return None
        last = ((metadata.get("prints") or {}).get("last") or {})
        if not last:
            return None
        started_epoch = None
        value = job.get("start_requested_at")
        if value:
            try:
                from datetime import datetime
                started_epoch = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
            except ValueError:
                started_epoch = None
        last_date = last.get("date")
        if started_epoch and last_date and float(last_date) + 2 < started_epoch:
            return None
        success = last.get("success")
        if success is True:
            return "completed"
        if success is False and observation.get("job_status") == "failed":
            return "failed"
        return None

    def _finalize(self, job_id: str, outcome: str, reason: str) -> None:
        job = self.store.load(job_id)
        if job.get("state") in TERMINAL_STATES:
            return
        self.store.set_state(job_id, outcome, reason=reason, terminal_at=utc_now())
        snapshot = TERMINAL_SNAPSHOTS.get(outcome)
        if snapshot:
            self._capture(job_id, snapshot[0], snapshot[1], required=False)

    def _monitor_loop(self) -> None:
        last_cleanup = 0.0
        while not self._stop.wait(self.config.poll_seconds):
            try:
                self.poll_once()
                if time.time() - last_cleanup >= 3600:
                    self.store.purge_synced_payloads(self.config.retention_days_after_sync)
                    last_cleanup = time.time()
            except Exception as error:  # il monitor non deve terminare per un singolo errore
                self._last_bridge_error = str(error)

    def poll_once(self) -> None:
        # Serializza il polling con start/cancel/pause/resume: una risposta
        # OctoPrint iniziata prima del comando non deve sovrascrivere
        # l'intenzione locale piÃ¹ recente.
        with self._lock:
            active_jobs = [job for job in self.store.nonterminal_jobs() if job.get("state") in ACTIVE_STATES]
            if not active_jobs:
                return
            try:
                raw = self.octoprint.state()
                observation = self.normalize_observation(raw)
            except Exception as error:
                for job in active_jobs:
                    self.store.append_event(job["job_id"], "monitor.unreachable", {"error": str(error)})
                return
            for listed_job in active_jobs:
                job_id = listed_job["job_id"]
                # Ricarica sotto lock per non usare uno stato letto prima di
                # un comando concorrente.
                job = self.store.load(job_id)
                previous_state = job.get("state")
                if previous_state not in ACTIVE_STATES:
                    continue
                remote = (job.get("octoprint") or {}).get("remote_path")
                active_file = observation.get("active_file")
                same_file = remote and active_file and Path(str(remote)).name == Path(str(active_file)).name
                observed_state = observation["job_status"]

                # L'intenzione di annullamento Ã¨ monotona: non viene mai
                # riportata a printing/paused da un'osservazione precedente.
                if previous_state == "cancel_requested":
                    if observed_state == "none":
                        self._finalize(job_id, "cancelled", "annullamento richiesto da Affetta e confermato da OctoPrint")
                    elif observed_state in ("failed", "interrupted"):
                        self._finalize(job_id, observed_state, "errore esplicito durante l'annullamento")
                    else:
                        self.store.update(job_id, last_observation=observation)
                    continue

                if same_file and observed_state in ("printing", "paused"):
                    self.store.set_state(job_id, observed_state, last_observation=observation)
                    progress = observation.get("progress_percent")
                    if progress is not None:
                        for threshold, key, filename in SNAPSHOT_PLAN:
                            if progress >= threshold:
                                self._capture(job_id, key, filename, required=False)
                    continue
                if observed_state == "cancel_requested" and previous_state in ("starting", "printing", "paused"):
                    self.store.set_state(job_id, "cancel_requested", reason="annullamento rilevato da OctoPrint")
                    continue
                if observed_state in ("failed", "interrupted") and previous_state in ACTIVE_STATES:
                    self._finalize(job_id, observed_state, "evento esplicito OctoPrint")
                    continue
                if previous_state in ("starting", "printing", "paused") and observed_state == "none":
                    outcome = self._explicit_terminal_from_file(job, observation)
                    if outcome:
                        self._finalize(job_id, outcome, "esito registrato da OctoPrint")
                    elif previous_state == "starting":
                        # puÃ² servire qualche polling prima che il file diventi attivo
                        age = time.time() - self._iso_epoch(job.get("start_requested_at"))
                        if age > 90:
                            self.store.set_state(job_id, "outcome_unknown", reason="avvio non confermato entro 90 secondi")
                    else:
                        self.store.set_state(job_id, "outcome_unknown", reason="stampa non piÃ¹ attiva, esito non verificabile")
    @staticmethod
    def _iso_epoch(value: str | None) -> float:
        if not value:
            return time.time()
        try:
            from datetime import datetime
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return time.time()
