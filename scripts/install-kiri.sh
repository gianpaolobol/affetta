#!/usr/bin/env sh
set -eu
TARGET="${1:-/opt/grid-apps}"
REF="${KIRI_GIT_REF:-master}"
if ! command -v git >/dev/null 2>&1; then echo "git è necessario" >&2; exit 1; fi
if [ -d "$TARGET/.git" ]; then
  git -C "$TARGET" fetch --depth 1 origin "$REF"
  git -C "$TARGET" checkout FETCH_HEAD
else
  git clone --depth 1 --branch "$REF" https://github.com/GridSpace/grid-apps.git "$TARGET"
fi
echo "Kiri:Moto installato in $TARGET"
echo "Imposta: KIRI_CLI_COMMAND=node $TARGET/src/kiri-run/cli"
