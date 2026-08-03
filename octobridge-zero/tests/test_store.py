import hashlib
import io
import tempfile
import unittest
from pathlib import Path

from affetta_octobridge.storage import JobStore
from affetta_octobridge.util import copy_and_hash


class StoreTests(unittest.TestCase):
    def test_create_is_idempotent_only_for_same_immutable_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp) / "jobs")
            metadata = {"job_id":"job-1","filename":"part.gcode","size_bytes":3,"sha256":"a"*64,"printer_profile_id":"anycubic-predator"}
            first = store.create(metadata)
            second = store.create(metadata)
            self.assertEqual(first["job_id"], second["job_id"])
            with self.assertRaises(FileExistsError):
                store.create({**metadata, "size_bytes": 4})

    def test_copy_and_hash_is_atomic_and_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = b"G28\nG1 X1 Y1\n"
            digest = hashlib.sha256(data).hexdigest()
            target = Path(tmp) / "job.gcode"
            size, actual = copy_and_hash(io.BytesIO(data), target, len(data), digest)
            self.assertEqual(size, len(data))
            self.assertEqual(actual, digest)
            self.assertEqual(target.read_bytes(), data)
            with self.assertRaises(ValueError):
                copy_and_hash(io.BytesIO(data + b"x"), target, len(data), digest)
            self.assertEqual(target.read_bytes(), data)


    def test_synced_payload_retention_keeps_metadata_and_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = JobStore(Path(tmp) / "jobs")
            metadata = {"job_id":"job-retention","filename":"part.gcode","size_bytes":3,"sha256":"b"*64,"printer_profile_id":"anycubic-predator"}
            store.create(metadata)
            gcode = store.gcode_path("job-retention", "part.gcode")
            gcode.parent.mkdir(parents=True, exist_ok=True)
            gcode.write_bytes(b"abc")
            image = store.snapshot_path("job-retention", "04_completed.jpg")
            image.write_bytes(b"jpeg")
            store.register_snapshot("job-retention", "completed", "04_completed.jpg", "c"*64, 4)
            store.set_state("job-retention", "completed")
            job = store.load("job-retention")
            store.acknowledge_sync("job-retention", job["event_sequence"], ["04_completed.jpg"])
            job = store.load("job-retention")
            job["sync"]["fully_synced_at"] = "2000-01-01T00:00:00Z"
            store.save("job-retention", job)
            self.assertEqual(store.purge_synced_payloads(1), ["job-retention"])
            self.assertFalse(gcode.exists())
            self.assertFalse(image.exists())
            self.assertTrue(store.metadata_path("job-retention").exists())
            self.assertTrue(store.events_path("job-retention").exists())


if __name__ == "__main__":
    unittest.main()
