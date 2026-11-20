# Load test report — `2026-11-15` — first ramp baseline + two DB fixes

Three runs of the same **ramp** profile against the same golden DB, one per backend build: the
baseline, then each fix deployed on its own. Same data (plus the few hundred invoices earlier
runs added, ~3 %), same scenario, same sizing — only the backend changed between runs.

## Setup

| | |
|---|---|
| Ref deployed | `docs/staging-env-plan` — run A `e3714fde` (V99), run B `c2c3ed67` (V101 indexes), run C `9c834b34` (V101 + agenda query) |
| Golden DB | `loadtest-V99-t10-s0` (**N = 10 tenants, M = 0 SIFEN tenants**), actual size 41.4 MB |
| Sizing | prod parity (no overrides): Container App 0.5 vCPU / 1 GiB, max 1 replica; SQL Basic 5 DTU |
| Container Apps environment | staging workload profiles (`Consumption`) vs prod consumption-only — run A started cold (scaled to zero, ~30 s first request); B and C started warm after their deploy |
| Profile | `ramp`: 0 → 10 (2 m) → 25 (5 m) → 50 (5 m) → 100 (5 m) → 0 (2 m) VUs |
| Scenario mix | 50 % issue a non-fiscal invoice + its PDF; rest: agenda 14 %, client search 11 %, ficha 8 %, invoice list 8 %, dashboard 6 %, report 3 % (+ an agenda load every iteration) |
| SIFEN rate | 0 (no SIFEN tenants) |
| Window (UTC) | A 00:06–00:27, B 00:39–00:59, C 01:42–02:02 (outside the 07–20 Mon–Sat Asunción wake window; the app was kept up by the test itself) |
| Runner | `scripts/staging/run-loadtest.sh` from an Azure VM (loadtest.yml can't be dispatched until it is on `main`) |
| Private report | `loadtest-reports/20261115-local000635-…`, `…-local003944-…`, `…-local014226-…` (`-loadtest-V99-t10-s0/`) |

## k6 summary (client side: throughput and errors)

| | A: V99 baseline | B: + invoice child indexes | C: + agenda query split |
|---|---|---|---|
| Requests | 2,253 | 2,690 | **4,682** |
| Throughput | 1.84 req/s | 2.33 req/s | **4.06 req/s** (×2.2 vs A) |
| Non-fiscal invoices issued | 356 | 465 | **848** (×2.4) |
| `http_req_failed` (< 2 %) | 5.59 % ✗ | 2.01 % ✗ | **1.05 % ✓** |

p95 per endpoint, ms (threshold in brackets) — all still fail under the full ramp:

| Endpoint (`name` tag) | Threshold | A | B | C |
|---|---|---|---|---|
| auth_login | 2000 | 31,867 | 26,675 | 13,350 |
| appointments_list | 1500 | 50,724 | 37,527 | 20,407 |
| appointment_create | 2000 | 56,899 | 38,908 | 19,733 |
| appointment_update | 2000 | 43,966 | 34,350 | 21,149 |
| service_record_create | 2000 | 57,013 | 41,229 | 20,532 |
| clients_search | 1500 | 32,582 | 29,832 | 15,770 |
| invoices_list | 1500 | 55,212 | 36,183 | 20,310 |
| invoices_report_xlsx | 8000 | 43,684 | 14,316 | 20,616 |
| invoices_report_pdf | 8000 | 41,695 | 31,140 | 15,822 |
| dashboard | 2500 | 49,433 | 31,056 | 19,438 |
| invoice_issue_non_fiscal | 3000 | 60,001 | 54,023 | 27,987 |

The whole-run p95 is dominated by the overload phase. Per load level it reads better
(all requests, p50 / p95 in seconds):

| VUs | A req/s | A p50 / p95 | B req/s | B p50 / p95 | C req/s | C p50 / p95 |
|---|---|---|---|---|---|---|
| 6 | 1.50 | 0.4 / 2.3 | 0.92 | 0.3 / 2.4 | 1.43 | **0.3 / 0.6** |
| 11 | 2.28 | 0.5 / 5.3 | 2.08 | 0.6 / 3.5 | 3.37 | **0.2 / 0.6** |
| 14 | 2.38 | 1.8 / 7.6 | 2.13 | 1.0 / 6.9 | 4.03 | 0.4 / 2.2 |
| 20 | 2.25 | 6.0 / 11.1 | 2.40 | 4.4 / 10.5 | 4.57 | 1.2 / 4.1 |
| 31 | 2.15 | 10.4 / 15.0 | 2.57 | 8.9 / 12.5 | 4.37 | 4.1 / 6.9 |
| 53 | 1.92 | 24.6 / 38.9 | 2.62 | 15.3 / 26.5 | 4.55 | 7.9 / 13.3 |
| 100 | 1.78 | 48.2 / 60.0 | 2.35 | 32.7 / 54.5 | 4.38 | 17.2 / 30.3 |

Runners and staging are both in Azure US, so k6 latency is lower than what users in Paraguay see.

## Server side (`scripts/staging/collect-loadtest-metrics.sh`)

| Metric | A | B | C | Comment |
|---|---|---|---|---|
| Container App CPU avg / max (of 0.5 vCPU) | 0.13 / 0.55 | 0.08 / 0.16 | 0.14 / 0.26 | app mostly waits on the DB |
| Working-set memory avg / max (of 1 GiB) | 862 / 886 MiB | 874 / 896 MiB | 876 / 909 MiB | flat, but < 120 MiB headroom |
| Replicas (max 1) | 1 | 1 | 1 | |
| Restarts | 0 | 0 | 0 | |
| SQL DTU % avg / max (Basic 5 DTU) | 82 / 100 | 84 / 100 | 81 / 100 | **saturated in every run** — C does ~2× the work at the same DTU |
| SQL storage (of 2 GB) | 3 % | 3 % | 3 % | |
| Cold start | ~30 s (A only) | — | — | app had scaled to zero; prod min replicas is 0 too |

Server-side durations, run C (App Insights; sampled, so counts are lower than k6's):

| Endpoint | p50 ms | p95 ms | p99 ms |
|---|---|---|---|
| GET /api/appointments | 986 | 4,210 | 6,424 |
| POST /api/invoices | 425 | 3,220 | 5,500 |
| GET /api/invoices/{id}/pdf | 290 | 1,823 | 4,602 |
| GET /api/invoices | 1,681 | 5,436 | 6,836 |
| GET /api/dashboard | 1,588 | 4,107 | 4,747 |
| GET /api/clients/page | 413 | 1,749 | 1,991 |
| POST /api/service-records | 350 | 1,669 | 3,512 |

## Findings

- **The SQL database (Basic, 5 DTU — the prod size) is what saturates**, in every run. The single
  0.5 vCPU replica never got above ~0.26 vCPU on average per minute after the fixes.
- **Fix 1 — `V101__invoice_child_fk_indexes.sql`** (indexes on `invoice_id` in `invoice_lines` and
  `invoice_payment_allocations`): those per-invoice lookups went from 4.6 ms CPU / 130–269 page
  reads to **0.1 ms / 4 reads**. They had been the top two SQL CPU consumers. Throughput +27 %,
  errors 5.6 % → 2.0 %.
- **Fix 2 — agenda "latest invoice per turno"** (`InvoiceRepository.findInvoiceIdsByAppointmentIds`):
  the `appointment_id = … OR service_record_id = …` join defeated both indexes and scanned every
  invoice of the tenant on each agenda load (41 ms CPU / ~4,800 reads, ~85–90 % of SQL CPU after
  fix 1). Split into two index-backed lookups: **~1.2 ms / ~130 reads**. Plus
  `hibernate.query.in_clause_parameter_padding=true` (fewer plan variants per IN-list length).
  Throughput ×1.75 on top of fix 1, errors 1.0 % (threshold met).
- **Capacity now:** with think times of 3–9 s per iteration, the system serves **~11 simultaneous
  receptionists with every endpoint at p95 ≤ 0.6 s**, ~14 at ≤ 2.2 s, and saturates around 17–20
  (≈ 4.4 req/s). Before: saturated at ~10 with p95 already 5 s at 11.
- **Next hot spots (run C, Query Store):**
  1. Agenda window query on `appointments` (5.7 ms / ~300 reads, every agenda load) — the
     tenant/time filter does not lead the existing `ix_appointments_tenant_time (tenant_id,
     professional_id, start_at)` index.
  2. **Clients loaded one by one: ~72,900 single-row lookups** in 20 min (~16 per HTTP request) —
     an N+1 (most likely the agenda's appointment → client mapping). Cheap each, but ~15 % of
     the remaining CPU.
  3. Dashboard aggregates (invoice lines by service, payments by method, appointment counts:
     15–17 ms / ~800–950 reads each).
- **Memory:** ~910 MiB of the 1 GiB limit at peak; flat across runs (no leak), but little headroom.
- **Scenario bug (not fixed during these runs, to keep them comparable):** on Sundays the agenda
  call asks for *next* week (week start computed with Sunday = 0). Fixed afterwards in
  `loadtest/scenarios/main.js`.

## Decision / follow-ups

- Ship fix 1 and fix 2 with this branch (PR #399 → `develop`).
- Next candidates, in expected-impact order: the clients N+1, an index leading with
  `(tenant_id, start_at)` for the agenda window, then the dashboard aggregates. Re-run this ramp
  after each, from a fresh `loadtest-V99-t10-s0` import (or a regenerated golden DB at the new
  Flyway version).
- Then the SIFEN tenants (`t10-s2`, `sifen_rate=2`) and a `soak` run for memory behaviour.

## Run D — 2026-11-16: appointments index (V102) + agenda N+1 fix, compared with run C

Same ramp, same golden DB (fresh import), same sizing. Build `39224ac7` = run C's build plus two
commits applied together: `V102` (`ix_appointments_tenant_start (tenant_id, start_at) INCLUDE …`)
and `findInRangeFiltered` fetching client / professional / service in the same query.
Window 18:06–18:25 UTC; private report `loadtest-reports/20261116-local180559-loadtest-V99-t10-s0/`.

**Caveat:** run C ran on a Sunday with the scenario's week-start bug (issue #431), so its agenda
calls hit next week's mostly empty window. Run D uses the fixed scenario (current week, populated).
D's agenda calls are therefore *heavier* than C's: the comparison understates the gain.

| | C: agenda split | D: + V102 + N+1 fix |
|---|---|---|
| Requests | 4,682 | **6,356** |
| Throughput | 4.06 req/s | **5.50 req/s** (×1.35) |
| Non-fiscal invoices issued | 848 | **1,129** (×1.33) |
| `http_req_failed` (< 2 %) | 1.05 % ✓ | 1.63 % ✓ |
| SQL DTU avg / max | 81 / 100 | 81 / 100 (still saturated) |
| CPU avg / max (of 0.5 vCPU) | 0.14 / 0.26 | 0.15 / 0.25 |
| Memory avg / max (of 1 GiB) | 876 / 909 MiB | 872 / 895 MiB |

All per-endpoint p95 thresholds still fail over the whole ramp (the overload phase dominates).
Per load level (all requests):

| VUs | C req/s | C p50 / p95 (s) | D req/s | D p50 / p95 (s) |
|---|---|---|---|---|
| 6 | 1.43 | 0.3 / 0.6 | 1.51 | 0.1 / 0.6 |
| 11 | 3.37 | 0.2 / 0.6 | 4.13 | 0.1 / 0.6 |
| 14 | 4.03 | 0.4 / 2.2 | 5.93 | 0.2 / 0.7 |
| 20 | 4.57 | 1.2 / 4.1 | 6.48 | 0.6 / 2.3 |
| 31 | 4.37 | 4.1 / 6.9 | 6.08 | 2.8 / 6.2 |
| 53 | 4.55 | 7.9 / 13.3 | 5.98 | 6.6 / 13.4 |
| 100 | 4.38 | 17.2 / 30.3 | 6.07 | 11.6 / 21.4 |

Capacity: ~14 simultaneous receptionists now stay at p95 ≤ 0.7 s (C: 11), ~20 at ≤ 2.3 s (C: 14 at
2.2 s); saturation at ~6 req/s (C: ~4.4). The DB is still the bottleneck, at ~6 req/s now.
Failed requests are mostly invoice issue (61 server-side), appointment create (74) and update (18)
under overload; not yet analysed by status code.
