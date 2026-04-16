#!/usr/bin/env bash
# Manual Playwright e2e run with timestamped evidence (HTML report, JSON, traces, screenshots, videos on failure).
# Starts Vite + Spring Boot (profile `e2e`, H2 in-memory) unless the backend is already up on :8080.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${ROOT}/e2e/evidence/run-${TS}"
mkdir -p "${OUT}"

export E2E_EVIDENCE_DIR="${OUT}"
export E2E_WITH_BACKEND="${E2E_WITH_BACKEND:-1}"

cd "${ROOT}/e2e"
if [[ ! -d node_modules ]]; then
  npm ci
else
  npm ci --prefer-offline 2>/dev/null || npm ci
fi

npx playwright test "$@"

echo ""
echo "Evidence written under: ${OUT}"
echo "  - html-report/index.html"
echo "  - results.json"
echo "  - artifacts/   (per-test output: traces, screenshots, video on failure)"
