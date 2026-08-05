import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from affetta_octobridge.config import BridgeConfig
from affetta_octobridge.jobs import JobConflict, JobManager
from affetta_octobridge.octoprint import OctoPrintError
from affetta_octobridge.storage import JobStore


class FakeCamera:
    def capture(self, destination):
        destination.parent.mkdir(parents=True, exist_ok=True)
        data = b"\xff\xd8fake-jpeg\xff\xd9"
        destination.write_bytes(data)
        return len(data), hashlib.sha256(data).hexdigest()


class FakeOctoPrint:
    def __init__(self):
        self.files = {}
        self.active = None
        self.completion = None
        self.mode = "ready"
        self.last_success = None
        self.started = False

    def upload_local(self, path, remote_name):
        self.files[remote_name] = path.read_bytes()
        return {"files":{"local":{"path":remote_name}}}

    def file_metadata(self, remote_path):
        value = {"size":len(self.files[remote_path])}
        if self.last_success is not None:
            value["prints"] = {"last":{"success":self.last_success,"date":4102444800}}
        return value

    def download_sha256(self, remote_path):
        data = self.files[remote_path]
        return len(data), hashlib.sha256(data).hexdigest()

    def connect(self, *args):
        pass

    def connection(self):
        return {"current":{"state":"Operational"}}

    def start(self, remote_path):
        self.active = remote_path
        self.mode = "printing"
        self.completion = 0.0
        self.started = True

    def cancel(self):
        self.mode = "ready"
        self.active = None

    def pause(self):
        self.mode = "paused"

    def resume(self):
        self.mode = "printing"

    def state(self):
        flags = {"operational": self.mode == "ready", "printing": self.mode == "printing", "paused": self.mode == "paused", "cancelling": self.mode == "cancelling", "closedOrError": self.mode == "closed"}
        file = {"path":self.active,"name":self.active} if self.active else {}
        return {
            "job":{"state":self.mode,"job":{"file":file},"progress":{"completion":self.completion,"printTime":10,"printTimeLeft":20}},
            "printer":{"state":{"text":self.mode,"flags":flags},"temperature":{"tool0":{"actual":200,"target":205}}},
            "connection":{"current":{"state":self.mode}},
        }


class JobTests(unittest.TestCase):
    def make(self, tmp):
        raw = {
            "api_token":"x"*40,"data_dir":str(Path(tmp)/"data"),"printer_profile_id":"anycubic-predator",
            "octoprint_api_key":"key","verify_remote_sha256":True,"require_pre_print_snapshot":True,"serial_printing_enabled":True,
            "poll_seconds":5,"camera":{},"live":{}
        }
        cfg_path = Path(tmp)/"config.json"
        cfg_path.write_text(json.dumps(raw))
        config = BridgeConfig(raw, cfg_path)
        store = JobStore(config.jobs_dir)
        octo = FakeOctoPrint()
        manager = JobManager(config, store, octo, FakeCamera())
        return manager, store, octo

    def stage(self, manager, data=b"G28\nG1 X10 Y10\n"):
        digest = hashlib.sha256(data).hexdigest()
        manager.create_job({"job_id":"job-1","filename":"test.gcode","size_bytes":len(data),"sha256":digest,"printer_profile_id":"anycubic-predator"})
        return manager.receive_gcode("job-1", io.BytesIO(data), len(data))


    def test_upload_and_transfer_are_blocked_while_another_job_is_printing(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, _ = self.make(tmp)
            active_data = b"G28\n"
            manager.create_job({
                "job_id": "active-job", "filename": "active.gcode",
                "size_bytes": len(active_data), "sha256": hashlib.sha256(active_data).hexdigest(),
                "printer_profile_id": "anycubic-predator",
            })
            manager.receive_gcode("active-job", io.BytesIO(active_data), len(active_data))
            store.set_state("active-job", "printing")

            payload = b"G1 X1\n"
            second = manager.create_job({
                "job_id": "queued-job",
                "filename": "queued.gcode",
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "printer_profile_id": "anycubic-predator",
            })
            with self.assertRaises(JobConflict):
                manager.receive_gcode(second["job_id"], io.BytesIO(payload), len(payload))
            store.set_state(second["job_id"], "staged")
            path = store.gcode_path(second["job_id"], second["filename"])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)
            with self.assertRaises(JobConflict):
                manager.transfer_to_octoprint(second["job_id"])

    def test_start_requires_verified_transfer_and_pre_snapshot(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            with self.assertRaises(JobConflict):
                manager.start_job("job-1")
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            job = store.load("job-1")
            self.assertTrue(octo.started)
            self.assertIn("pre_print", job["snapshots"])
            self.assertEqual(job["state"], "starting")

    def test_remote_integrity_failure_is_retryable_octoprint_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            original_download = octo.download_sha256
            octo.download_sha256 = lambda remote_path: (
                len(octo.files[remote_path]),
                "0" * 64,
            )
            with self.assertRaises(OctoPrintError) as caught:
                manager.transfer_to_octoprint("job-1")
            self.assertEqual(caught.exception.code, "remote_integrity_mismatch")
            self.assertEqual(store.load("job-1")["state"], "staged")
            octo.download_sha256 = original_download
            manager.transfer_to_octoprint("job-1")
            self.assertEqual(store.load("job-1")["state"], "transferred")
    def test_progress_and_terminal_snapshots_are_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            octo.completion = 51
            manager.poll_once()
            job = store.load("job-1")
            self.assertIn("progress_25", job["snapshots"])
            self.assertIn("progress_50", job["snapshots"])
            first_count = len(job["snapshots"])
            manager.poll_once()
            self.assertEqual(len(store.load("job-1")["snapshots"]), first_count)
            octo.mode = "ready"
            octo.active = None
            octo.last_success = True
            manager.poll_once()
            job = store.load("job-1")
            self.assertEqual(job["state"], "completed")
            self.assertIn("completed", job["snapshots"])

    def test_cancel_is_explicit(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            octo.mode = "printing"
            manager.poll_once()
            manager.cancel_job("job-1")
            manager.poll_once()
            job = store.load("job-1")
            self.assertEqual(job["state"], "cancelled")
            self.assertIn("cancelled", job["snapshots"])


    def test_cancel_intent_is_persisted_before_remote_side_effect(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            octo.mode = "printing"
            manager.poll_once()
            observed = []
            original_cancel = octo.cancel

            def cancel_after_observing_intent():
                observed.append(store.load("job-1")["state"])
                original_cancel()

            octo.cancel = cancel_after_observing_intent
            job = manager.cancel_job("job-1")
            self.assertEqual(observed, ["cancel_requested"])
            self.assertEqual(job["state"], "cancelled")

    def test_stale_printing_observation_does_not_erase_cancel_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            octo.mode = "printing"
            manager.poll_once()
            store.set_state("job-1", "cancel_requested")
            manager.poll_once()
            self.assertEqual(store.load("job-1")["state"], "cancel_requested")
            octo.cancel()
            manager.poll_once()
            self.assertEqual(store.load("job-1")["state"], "cancelled")
    def test_external_cancellation_is_recorded_when_octoprint_exposes_cancelling(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            octo.mode = "printing"
            manager.poll_once()
            octo.mode = "cancelling"
            manager.poll_once()
            self.assertEqual(store.load("job-1")["state"], "cancel_requested")
            octo.mode = "ready"
            octo.active = None
            manager.poll_once()
            self.assertEqual(store.load("job-1")["state"], "cancelled")

    def test_closed_connection_without_active_file_does_not_invent_interruption(self):
        observation = JobManager.normalize_observation({
            "job":{"job":{"file":{}},"progress":{}},
            "printer":{"state":{"text":"Closed","flags":{"closedOrError":True}},"temperature":{}},
            "connection":{"current":{"state":"Closed"}}
        })
        self.assertEqual(observation["job_status"], "none")

    def test_reconciliation_does_not_invent_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            manager, store, octo = self.make(tmp)
            self.stage(manager)
            manager.transfer_to_octoprint("job-1")
            manager.start_job("job-1")
            store.set_state("job-1", "printing")
            octo.mode = "ready"
            octo.active = None
            octo.last_success = None
            manager.reconcile_startup()
            self.assertEqual(store.load("job-1")["state"], "outcome_unknown")


if __name__ == "__main__":
    unittest.main()
