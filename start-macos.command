#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
[ -f .env ] || node scripts/init.mjs
exec node scripts/start-posix.mjs
