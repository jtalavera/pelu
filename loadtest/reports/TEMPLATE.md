# Load test report — `<YYYY-MM-DD>` — `<short title>`

> Copy this file to `loadtest/reports/<YYYY-MM-DD>-<ref>-t<N>-s<M>.md`. Commit **only
> aggregates**: no e-mails, tokens or request bodies (the repo is public). Raw k6 output stays in
> the private `loadtest-reports/` container.

## Setup

| | |
|---|---|
| Ref deployed | `<branch/tag>` (`<sha>`) |
| Golden DB | `loadtest-V<v>-t<N>-s<M>` (**N = <N> tenants, M = <M> SIFEN tenants**), actual size `<MB>` |
| Sizing | prod parity · or **WHAT-IF: `<-var overrides>`** (temporary, never committed) |
| Container Apps environment | staging `<type>` vs prod `<type>` (from the up.sh report — workload profiles vs consumption-only can affect cold starts) |
| Profile | `smoke` / `ramp` / `soak` · or flat `<VUS>` VUs × `<DURATION>` |
| SIFEN rate | `<n>`/min across the M SIFEN tenants |
| Window (UTC) | `<start>` → `<end>` (inside the 07–20 Mon–Sat Asunción wake window? yes/no) |
| Workflow run | `<url>` |
| Private report | `loadtest-reports/<prefix>/` |

## k6 summary (client side: throughput and errors)

Paste the summary from the workflow log or `summary.txt`. Runners are in Azure US regions close
to `centralus`, so k6 latency is **lower than what users in Paraguay see**. Use it for capacity
(throughput, error rate, the point where it saturates), not for user-facing response times.

| Endpoint (`name` tag) | Requests | p95 ms | Threshold | Pass |
|---|---|---|---|---|
| auth_login | | | 2000 | |
| appointments_list | | | 1500 | |
| appointment_create / _update | | | 2000 | |
| service_record_create | | | 2000 | |
| clients_search | | | 1500 | |
| invoices_list | | | 1500 | |
| invoices_report_xlsx / _pdf | | | 8000 | |
| dashboard | | | 2500 | |
| invoice_issue_non_fiscal | | | 3000 | |
| invoice_issue_sifen | | | 5000 | |
| **http_req_failed** | | | < 2 % | |

Business counters: `non_fiscal_invoices_issued`, `sifen_invoices_issued`, `sifen_range_exhausted`.

## Server side (`scripts/staging/collect-loadtest-metrics.sh --run=<prefix>`)

Paste `metrics.md`, or read the same numbers from the **"Femme - Infra (staging)"** workbook.

| Metric | Avg | Max | Comment |
|---|---|---|---|
| Container App CPU (of 0.5 vCPU) | | | |
| Working-set memory (of 1 GiB) | | | |
| Replicas (max 1, prod limit) | | | |
| Restarts | | | |
| SQL DTU % (Basic 5 DTU, prod limit) | | | |
| SQL storage (of 2 GB) | | | |
| Cold start (`/health` 200 after scale-from-zero) | | | from the `up.sh` report / replica starts |

Server-side request durations per endpoint (App Insights, **use these for user-facing latency**):

| Endpoint | p50 | p95 | p99 | Failed |
|---|---|---|---|---|

## Findings

- What saturated first (the DB at 5 DTU, or the single 0.5 vCPU replica) and at what load.
- Errors and their cause.
- Regressions compared with the previous report.

## Decision / follow-ups

- …
