# Playwright evidence (local runs)

**Acceptance criteria matrix:** see [`ACCEPTANCE_MATRIX.md`](./ACCEPTANCE_MATRIX.md) — maps each user-story acceptance criterion to Playwright coverage (✅/⚠️/❌/🔶). **Policy:** every e2e change should aim for **at least one explicit validation per criterion**; gaps and unclear cases are listed there.

Each manual run of `scripts/run-e2e-with-evidence.sh` (or `npm run test:with-evidence` from this directory) creates:

- `run-YYYYMMDD-HHMMSS/html-report/` — Playwright HTML report (`index.html`)
- `run-.../results.json` — machine-readable summary
- `run-.../artifacts/` — per-test output (screenshots on failure; **video for every test** locally, or only on failure when `CI` is set / `E2E_VIDEO=retain-on-failure`; traces when configured)

This folder is gitignored; keep runs locally for debugging and QA evidence.
