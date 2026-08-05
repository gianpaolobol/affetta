#!/usr/bin/env python3
from __future__ import print_function

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5000")
    parser.add_argument("--api-key-file", required=True, type=Path)
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()

    api_key = args.api_key_file.read_text(encoding="utf-8").strip()
    request = urllib.request.Request(
        args.url.rstrip("/") + "/api/version",
        headers={"X-Api-Key": api_key, "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print("[ERRORE] OctoPrint HTTP {0}; verificare API key.".format(error.code), file=sys.stderr)
        return 2
    except Exception as error:
        print("[ERRORE] OctoPrint non raggiungibile: " + str(error), file=sys.stderr)
        return 3

    print("[OK] OctoPrint raggiungibile.")
    print("[OK] Versione server: " + str(payload.get("server") or payload.get("version") or "sconosciuta"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
