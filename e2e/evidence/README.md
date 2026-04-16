# Playwright evidence (local runs)

Each manual run of `scripts/run-e2e-with-evidence.sh` (or `npm run test:with-evidence` from this directory) creates:

- `run-YYYYMMDD-HHMMSS/html-report/` — Playwright HTML report (`index.html`)
- `run-.../results.json` — machine-readable summary
- `run-.../artifacts/` — per-test output (screenshots and video on failure, traces when configured)

This folder is gitignored; keep runs locally for debugging and QA evidence.
