#!/usr/bin/env bash
# Snapshot obelisk-dex's src/ at a fixed commit into vendor/obelisk, so the
# build reuses the app's real code (mentions, read-state selectors, voice
# mesh, the session vault) without moving when obelisk-dex changes.
# Usage: scripts/vendor-obelisk.sh [commit]   (default: obelisk-dex HEAD)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=${OBELISK_DEX:-/root/obelisk-dex}
COMMIT=$(git -C "$REPO" rev-parse "${1:-HEAD}")
rm -rf vendor/obelisk
mkdir -p vendor/obelisk
git -C "$REPO" archive "$COMMIT" src public/icon-192.png public/icon-512.png public/obelisk-favicon.png public/obelisk.stl \
  | tar -x -C vendor/obelisk
# The favicon lives under src/app in the app (Next file convention).
cp vendor/obelisk/src/app/favicon.ico vendor/obelisk/public/favicon.ico
echo "$COMMIT" > vendor/obelisk/COMMIT
echo "vendored obelisk-dex src @ $COMMIT"
