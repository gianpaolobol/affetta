#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

while IFS= read -r -d '' file; do
    bash -n "${file}"
done < <(find "${ROOT}" -type f -name '*.sh' -print0)

python3 - "${ROOT}" <<'PY'
import ast
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])

for path in root.rglob("*.json"):
    json.loads(path.read_text(encoding="utf-8"))

for path in root.rglob("*.py"):
    source = path.read_text(encoding="utf-8")
    ast.parse(source, filename=str(path), feature_version=(3, 7))

print("JSON validi e Python compatibile con grammatica 3.7.")
PY

printf 'Test statici completati.\n'
