#!/usr/bin/env bash
# Finds and kills any process listening on the backend's port (8080).
set -euo pipefail

PORT="${1:-8080}"

PIDS=$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)

if [[ -z "$PIDS" ]]; then
  echo "No process listening on port ${PORT}."
  exit 0
fi

echo "Killing process(es) on port ${PORT}: ${PIDS}"
kill -9 $PIDS
echo "Done."
