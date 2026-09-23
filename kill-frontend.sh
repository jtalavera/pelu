#!/usr/bin/env bash
# Finds and kills any process listening on the frontend's port (5173).
set -euo pipefail

PORT="${1:-5173}"

PIDS=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)

if [[ -z "$PIDS" ]]; then
  echo "No process listening on port ${PORT}."
  exit 0
fi

echo "Killing process(es) on port ${PORT}: ${PIDS}"
kill -9 $PIDS
echo "Done."
