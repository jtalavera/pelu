# Load testing (`loadtest/`)

Load tests run against the disposable, prod-parity **staging** environment
([docs/staging-env.md](../docs/staging-env.md), T6/T7). Never point them at dev or prod.

| Path | What |
|---|---|
| `seed/` | Golden multi-tenant DB generator (`--tenants=N`, multiple of 10; `--sifen-tenants=M`). See [seed/README.md](seed/README.md). |
| `scenarios/` | k6 scenarios: login + session refresh, agenda reads, create/edit appointment, save ficha, client search, invoice list, Historial report (xlsx/pdf), dashboard, non-fiscal issuance, and throttled SIFEN issuance on the M SIFEN tenants only. |
| `reports/` | `TEMPLATE.md` for the results write-up. Commit aggregates only. |

## Running a load test

```bash
# 1. Golden DB for the N/M you want (once; reuse the BACPAC afterwards)
scripts/staging/up.sh --data=empty --ref=develop
scripts/staging/seed-golden-db.sh --tenants=10 --sifen-tenants=2
scripts/staging/down.sh

# 2. Staging on that DB, with the ref under test
scripts/staging/up.sh --recreate --data=loadtest --bacpac=loadtest-V<v>-t10-s2 --ref=<ref>

# 3. Actions → "Load test (staging)" → Run workflow (approve the v2-staging deployment)
gh workflow run loadtest.yml -f ref=<ref> -f bacpac=loadtest-V<v>-t10-s2 -f profile=ramp -f sifen_rate=2
#    …or from an Azure VM, no approval needed (also the only way until loadtest.yml is on main:
#    GitHub dispatches workflow_dispatch workflows only from the default branch)
scripts/staging/run-loadtest.sh --bacpac=loadtest-V<v>-t10-s2 --ref=<ref> --profile=ramp --sifen-rate=2
#    scaling test: N active tenants, one receptionist each, fixed arrival rate (open model),
#    90 % of them on SIFEN when the golden DB has SIFEN tenants. avg = 15 invoices/day/tenant
#    (30 iterations/day over 8 h); peak = 4x that. Needs a golden DB with at least N tenants.
scripts/staging/run-loadtest.sh --bacpac=loadtest-V<v>-t100-s90 --ref=<ref> --profile=scale --active=50 --load=peak --duration=15m

# 4. Server-side metrics while staging still exists, then fill loadtest/reports/TEMPLATE.md
scripts/staging/collect-loadtest-metrics.sh --run=<prefix printed by the workflow / run-loadtest.sh>

# 5. Tear down
scripts/staging/down.sh
```

## Rules

- `max_replicas = 1` and SQL Basic 5 DTU **are the prod limits being measured**. Expect the DB or
  the single replica to saturate first; that is the finding.
- "What-if" sizing runs: `up.sh --tf-var=backend_max_replicas=2 …`. They are temporary, labeled in
  the up.sh report, and never committed to the staging tfvars.
- Run inside the wake window (07–20 Mon–Sat, Asunción), or account for scale-to-zero cold starts
  as prod does.
- SIFEN issuance is throttled (`sifen_rate`, per minute across all SIFEN tenants): every SIFEN
  tenant shares Femme Coiffure's RUC and timbrado on `sifen-test`. A tenant that uses up its
  100-number block gets `FISCAL_STAMP_RANGE_EXHAUSTED`, and k6 stops issuing for it.
- Public repo: the scripts never log bodies, tokens or e-mails, and the detailed k6 output goes to
  the private `loadtest-reports/` container, not to workflow artifacts.
- No inbound rate limiting exists today. If login throttling is added, it must exempt the staging
  load-test users (or staging), or the test measures the limiter.
