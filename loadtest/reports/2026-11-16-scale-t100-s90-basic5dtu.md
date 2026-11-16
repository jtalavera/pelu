# Load test report — `2026-11-16` — scaling to 100 active tenants (SQL Basic 5 DTU)

Realistic "invoice-first" tenants at 10, 20, 30, 50 and 100 active tenants, each at the average
and at a 4x peak arrival rate. Build `39224ac7` (V102 appointments index + agenda N+1 fix).

## Setup

| | |
|---|---|
| Ref deployed | `docs/staging-env-plan` @ `39224ac7` (V102) |
| Golden DB | `loadtest-V102-t100-s90`: **100 tenants, 90 SIFEN**, 368.4 MB (estimate 365.5), ~400 clients / ~1,950 appointments / ~1,550 invoices per tenant, same shape as `t10-s0` |
| Sizing | prod parity: Container App 0.5 vCPU / 1 GiB, max 1 replica; **SQL Basic 5 DTU** |
| Profile | `scale`: open model (constant arrival rate), one receptionist per active tenant, 15 min per run, **no ramp** |
| Arrival rate per tenant | **avg** = 30 iterations/day over 8 h (= 15 invoices/day at the 50 % invoice share) = 3.75/h; **peak** = 4x = 15/h |
| Iteration | agenda load, then one action from the usual mix (50 % invoice, 14 % appointment, 11 % client search, 8 % ficha, 8 % invoice list, 6 % dashboard, 3 % report) |
| SIFEN | 90 % of the active tenants are SIFEN tenants and issue **real SIFEN invoices against sifen-test**; each SIFEN tenant has its own 100-number block (numbering base 1,000,000) |
| Login | once per tenant in setup (token valid 8 h), like a user who logs in once a day |
| Window (UTC) | 2026-11-16 20:14–22:53, ten runs back to back, no restart between them |
| Runner | `scripts/staging/run-loadtest.sh --profile=scale` from an Azure VM |
| Private reports | `loadtest-reports/20261116-local2…-loadtest-V102-t100-s90/` (10 prefixes) |

## Results

Every run: **0 failed requests, every threshold met, 0 dropped iterations**.

| Active tenants | Load | Iterations | Requests | req/s | SIFEN inv. | Non-fiscal inv. | p50 ms | p95 ms | DTU avg / max % | CPU avg / max (of 0.5) |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 | avg | 10 | 72 | 0.08 | 6 | 1 | 98 | 476 | 3.8 / 14.5 | 0.02 / 0.07 |
| 10 | peak | 38 | 126 | 0.14 | 17 | 0 | 91 | 495 | 4.3 / 10.5 | 0.03 / 0.06 |
| 20 | avg | 19 | 148 | 0.16 | 11 | 0 | 76 | 447 | 3.6 / 13.5 | 0.02 / 0.08 |
| 20 | peak | 76 | 258 | 0.28 | 34 | 4 | 84 | 482 | 5.6 / 12.3 | 0.03 / 0.06 |
| 30 | avg | 29 | 219 | 0.24 | 13 | 0 | 66 | 412 | 4.3 / 17.5 | 0.02 / 0.08 |
| 30 | peak | 113 | 385 | 0.42 | 52 | 2 | 87 | 445 | 6.8 / 17.0 | 0.03 / 0.09 |
| 50 | avg | 48 | 369 | 0.40 | 29 | 1 | 61 | 408 | 5.7 / 27.3 | 0.02 / 0.11 |
| 50 | peak | 188 | 641 | 0.70 | 90 | 6 | 82 | 424 | 9.5 / 29.0 | 0.03 / 0.10 |
| 100 | avg | 94 | 745 | 0.79 | 41 | 2 | 67 | 359 | 9.0 / 36.0 | 0.03 / 0.21 |
| 100 | peak | 376 | 1,288 | 1.37 | 180 | 14 | 80 | 404 | 16.7 / 37.5 | 0.05 / 0.19 |

(req/s is averaged over the whole run including setup; whole-run p50/p95 over all requests.)

p95 per endpoint, ms (blank = fewer than a handful of samples), 100 tenants:

| Endpoint | threshold | 100 avg | 100 peak |
|---|---|---|---|
| auth_login | 2000 | 190 | 211 |
| appointments_list | 1500 | 100 | 134 |
| appointment_create / update | 2000 | 97 / 82 | 108 / 113 |
| service_record_create | 2000 | 84 | 83 |
| clients_search | 1500 | 86 | 115 |
| invoices_list | 1500 | 232 | 168 |
| invoices_report xlsx / pdf | 8000 | 345 / 112 | 254 / 167 |
| dashboard | 2500 | 87 | 722 |
| invoice_issue_non_fiscal | 3000 | 129 | 228 |
| **invoice_issue_sifen** | 5000 | **530** | **609** |

Smoke run before the series (cold app, 5 min, 10 tenants at peak): the first dashboard call took
5.6 s and login p95 was 2.2 s (cold JVM / first requests); both were normal in every later run.

## Findings

- **100 invoice-first tenants fit comfortably on the prod DB (Basic 5 DTU).** At 4x the average
  rate, DTU averages 16.7 % (max 37.5 %) and every endpoint stays under 0.75 s p95.
- **Headroom.** DTU grows roughly linearly with active tenants (10 → 100 tenants ≈ 4 % → 17 %
  average at peak). Extrapolating, the DB would saturate at roughly 200–400 such tenants at 4x peak
  — an estimate, not measured (the 200-tenant case was dropped).
- **The earlier receptionist ramp** (a heavy 3–9 s think-time user) saturated the same DB at ~6 req/s;
  the realistic 100-tenant peak is 1.37 req/s, about a quarter of that.
- **SIFEN works at scale on sifen-test.** 180 real SIFEN invoices in 15 min (≈12/min) from 90
  tenants, all approved, p95 609 ms; no range exhaustion (≈2 invoices per tenant per run).
- **Memory is the thing to watch**: working set rose from 863 MiB (first run) to 924–932 MiB
  (last) of 1,024 MiB across the 2.5 h with no restart. Not enough data to say whether it is
  tenant count or heap growth over time; a soak run would tell.
- **What this does not cover**: 15-minute windows (small samples at low scale — the 10-tenant
  average run is only 10 iterations); no SQL maintenance, Flyway migration or reconciler spikes at
  the same time; DB data volume of ~1 year per tenant (a longer history would cost more).

## Data generation notes (fixes made while building `t100-s90`)

- `sql_query` now passes `-y 0`: sqlcmd truncated long `FOR JSON` values at 256 bytes.
- `seed-golden-db.sh` disables the app's e-mail (`ACS_ENABLED=false`) while provisioning and waits
  for the new revision: each admin invite e-mailed an `@loadtest.invalid` address and ACS answered
  429 after a few tenants.
- `collect-loadtest-metrics.sh` retries Azure Monitor (flaky "Failed to find metric configuration")
  and degrades to n/a per metric.

## Follow-ups

- Same series on SQL **S0 (10 DTU)** — only after the owner confirms.
- A `soak` run at ~100 tenants / peak for memory behaviour (the 1 GiB limit).
- Remaining hot spots from the first ramp report (dashboard aggregates; the ramp is the way to
  surface them, the realistic load does not stress them).
