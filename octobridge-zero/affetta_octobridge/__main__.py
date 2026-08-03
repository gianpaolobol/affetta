from __future__ import annotations

import json
import signal
import sys
from pathlib import Path

from .api import serve
from .camera import Camera, LiveSession
from .config import load_config
from .jobs import JobManager
from .octoprint import OctoPrintClient
from .storage import JobStore


def main() -> int:
    config = load_config()
    config.data_dir.mkdir(parents=True, exist_ok=True)
    store = JobStore(config.jobs_dir)
    camera = Camera(config.camera)
    live = LiveSession(config.live)
    octoprint = OctoPrintClient(config.octoprint_url, config.octoprint_api_key, config.request_timeout_seconds)
    manager = JobManager(config, store, octoprint, camera, live=live)
    catalog_path = Path(config.raw.get("printer_catalog", "/opt/affetta-octobridge/config/printer-catalog.json"))
    with catalog_path.open("r", encoding="utf-8") as handle:
        catalog_doc = json.load(handle)
    catalog = list(catalog_doc.get("printers") or [])
    manager.start_monitor()
    print(
        f"Affetta OctoBridge Zero Snapshot EXPERIMENTAL su http://{config.bind_host}:{config.bind_port} "
        f"profilo={config.printer_profile_id or 'non configurato'} production_ready=false",
        flush=True,
    )
    serve(manager, store, config.api_token, catalog, live, config.bind_host, config.bind_port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
