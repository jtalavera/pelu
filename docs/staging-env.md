# Staging environment (`femme-staging-rg`) — plan

> Status: **plan only** — nothing below is implemented yet. Each task (T1…T8) has acceptance checks.

## 1. Purpose & principles

A **disposable, production-like** environment used to test important changes before they reach
production (risky migrations, infra changes, performance-sensitive features, release candidates).

| | |
|---|---|
| Subscription | `677a6eab-1283-48ee-a110-f40cf4a6df42` (same as dev/test) |
| Resource group | `femme-staging-rg` (`${name_prefix}-${environment}-rg` with `environment = "staging"`) |
| Lifecycle | Created on demand, **destroyed and recreated** for every important change. Never patched by hand. |
| Data | One of: **(A)** sanitized snapshot of the prod DB, **(B)** "golden" multi-tenant load-test DB, **(C)** empty (fresh Flyway) |

Principles:

1. **Prod parity is enforced, not remembered.** Every SKU, size, replica count, concurrency
   setting, scale rule, probe, quota and retention that affects performance, cost or scalability
   is identical to prod. The only allowed differences are listed in §2.2, and a check (T2) fails
   on any other drift.
2. **Same code, same Terraform.** Staging is a third environment of the existing
   `infrastructure_v2/` root module. There is no fork or copy of `main.tf`.
3. **One command up, one command down** (`scripts/staging/up.sh`, `scripts/staging/down.sh`).
4. **Staging can never reach real people or real systems.** No real emails, no SIFEN
   PRODUCTION, no Stock calls, no usable prod credentials.

## 2. Parity matrix

### 2.1 Must match prod

Values hard-coded in `infrastructure_v2/main.tf` match automatically because staging uses the
same module. Values that come from tfvars must be copied from `environments/prod/terraform.tfvars`
into `environments/staging/terraform.tfvars`, and T2 verifies them.

| Resource / parameter | Prod value | Source |
|---|---|---|
| Region (`location`, `sql_server_location`) | `centralus`, `""` | tfvars |
| Static Web App SKU | `Free` | main.tf |
| Container App CPU / memory | 0.5 vCPU / 1Gi | main.tf |
| Container App `min_replicas` / `max_replicas` | 0 / 1 | tfvars |
| HTTP scale rule `concurrent_requests` | 10 | main.tf |
| Wake schedule (KEDA cron) | enabled, 07:00–20:00 Mon–Sat, `America/Asuncion`, 1 replica | tfvars (+ variable defaults) |
| `backend_report_warmup_enabled` | `true` (default; dev overrides it to `false`, staging **must not**) | tfvars |
| Startup / liveness / readiness probes | TCP, same timings | main.tf |
| Revision mode | Single, `max_inactive_revisions = 0` | main.tf |
| Azure SQL SKU | `Basic` (5 DTU, 2 GB) | main.tf |
| SQL backup storage redundancy | `Zone` | tfvars |
| SQL auth | Entra-only, MI passwordless JDBC | main.tf |
| Service Bus namespace SKU | `Basic` | main.tf |
| Queues `sifen-submission` / `stock-integration` | max delivery 6, lock PT5M, TTL P7D, DLQ on expiry | main.tf |
| Log Analytics SKU / retention / daily cap | `PerGB2018` / 30 d / 0.5 GB | main.tf + tfvars |
| Application Insights retention | 30 d | main.tf |
| App Insights agent log level (`backend_ai_logging_level`) | `INFO` | tfvars (default) |
| Agent sampling, JVM flags | same image → same `applicationinsights.json` / Dockerfile | image |
| Key Vault SKU, RBAC | `standard`, RBAC | main.tf |
| ACS email domain | AzureManaged (prod sets no `email_custom_domain`) | tfvars |
| `stock_enabled` / `stock_api_base_url` | `true` / unset (→ `STOCK_NOT_CONFIGURED`) | tfvars |
| Backend image | the git ref under test, built the same way as prod (`deploy-azure.yml`) | CI |

### 2.2 Allowed deviations (none affect performance or scale)

| Parameter | Staging | Why |
|---|---|---|
| `environment` | `staging` | RG and resource naming |
| `sifen_environment` | `TEST` — **never** `PRODUCTION` | Staging must never send real fiscal documents |
| `key_vault_soft_delete_retention_days` / `purge_protection_enabled` | 7 / `false` | A disposable vault must be purgeable; purge protection is irreversible |
| `frontend_custom_domains`, `website_*` | unset | `flowbit.tech` belongs to prod |
| `manage_resource_providers` (new, T1) | `false` | The dev state already owns the subscription's provider registrations |
| State key | `staging.tfstate` in the dev state account | Separate state |
| Data | sanitized (§T5) | Privacy and safety |

## 3. Tasks

### T1 — Terraform: add the `staging` environment

- [ ] `variables.tf`: allow `staging` in the `environment` validation (`test|prod|staging`).
- [ ] New `manage_resource_providers` bool (default `true`). Add
      `count = var.manage_resource_providers ? 1 : 0` on
      `azurerm_resource_provider_registration.app` and `.communication`, and fix the
      `depends_on` references.
      **Critical:** without this, a staging apply fails because the registration already exists,
      and a staging `destroy` would **unregister `Microsoft.App`** across the whole subscription,
      which breaks dev. The existing dev/prod states need a `terraform state mv` to the `[0]`
      addresses (or a `moved {}` block) so they don't plan a destroy.
- [ ] `environments/staging/backend.hcl`: same account as dev (`rg-terraform-state-dev` /
      `sttfstatedev3tfruqf0` / `tfstate`) with `key = "staging.tfstate"`. It overrides the `key` in
      `versions.tf`.
- [ ] `environments/staging/terraform.tfvars`: subscription `677a6eab…`,
      `environment = "staging"`, every value from §2.1, the deviations from §2.2, same
      `entra_sql_admin_*` and `deployer_ip` as dev.
- [ ] Update the environments table and apply commands in `infrastructure_v2/infrastructure_v2.md`.

**Acceptance:** `terraform plan` for staging creates `femme-staging-rg` with no provider
registrations. `terraform plan` for dev and for prod shows **no changes**.

### T2 — Parity guard

- [ ] `scripts/staging/check-parity.sh`:
  - parses `environments/prod/terraform.tfvars` and `environments/staging/terraform.tfvars`
  - compares every performance/cost/scale key from §2.1, taking variable defaults into account
    when a key is absent (e.g. `backend_report_warmup_enabled`)
  - fails on any difference not listed in the §2.2 allowlist
- [ ] Runs as a CI step on PRs that touch `infrastructure_v2/**`, so a prod sizing change without
      the matching staging change fails the PR.
- [ ] Live drift check in `up.sh`: read the **live** prod settings (`az sql db show` SKU,
      `az containerapp show` cpu/memory/scale) and compare them to the staging tfvars. The SQL
      tier was once changed by hand in the Portal, so tfvars alone can't be trusted.

**Acceptance:** changing `backend_max_replicas` in prod tfvars only makes the check fail, and
adding it to staging too makes it pass.

### T3 — Lifecycle scripts

- [ ] `scripts/staging/up.sh --data=prod|loadtest|empty --ref=<git ref> [--bacpac=<name>]`:
  1. Preflight:
     - `az account show` is on subscription `677a6eab…`
     - `femme-staging-rg` does not exist (or `--recreate` runs `down.sh` first)
     - `sifen_environment == TEST` in the staging tfvars (abort otherwise)
     - T2 parity check passes
  2. `terraform init -reconfigure -backend-config=environments/staging/backend.hcl` and
     `terraform apply -var-file=environments/staging/terraform.tfvars`. The container starts on
     the hello-world image, so **Flyway has not touched the DB yet**.
  3. Data restore (T5 or T6) into the empty DB, unless `--data=empty`.
  4. Managed-identity DB user grant (runbook in `infrastructure_v2.md`).
  5. Seed `app-femme-jwt-secret` with a fresh random value. Set the platform-admin credentials
     the same way prod gets them.
  6. Update GitHub Environment `v2-staging`:
     - secrets: `AZURE_STATIC_WEB_APPS_API_TOKEN`, `VITE_API_BASE_URL`,
       `AZURE_RESOURCE_GROUP_NAME`, `AZURE_CONTAINER_APP_NAME`
     - variable: `VITE_APPINSIGHTS_CONNECTION_STRING`

     Use `gh secret set --env v2-staging` / `gh variable set`; the values come from
     `terraform output`.
  7. `gh workflow run deploy-v2.yml --ref <git ref> -f environment=v2-staging` and wait for it.
  8. Smoke test: `/health` returns 200, a login works, Flyway history shows the expected version.
     Print the SPA and API URLs.
- [ ] `scripts/staging/down.sh`:
  1. `terraform destroy` with the staging tfvars, so state stays consistent.
  2. `az keyvault purge` the soft-deleted vault.
  3. Clear the `v2-staging` secrets that point at dead resources.
  4. Confirm the RG is gone.

  Documented fallback when destroy gets stuck: `az group delete -n femme-staging-rg`, then delete
  the `staging.tfstate` blob.

**Acceptance:** `up.sh --data=empty` followed by `down.sh` leaves no `femme-staging-rg`, no
soft-deleted vault and an unchanged dev environment.

### T4 — CI / OIDC

- [ ] `deploy-v2.yml`: add `v2-staging` to the `workflow_dispatch` `environment` options. No
      push trigger: staging deploys only on demand.
- [ ] Create GitHub Environment `v2-staging` with the same secret names as `v2-test`.
- [ ] Federated credential `environment:v2-staging` on the test-subscription app registration.
- [ ] Role for that app registration at **subscription scope**, or re-created by `up.sh` after
      every apply. A role assigned on the RG disappears when the RG is deleted.

**Acceptance:** a manual dispatch with `v2-staging` deploys backend and frontend into
`femme-staging-rg`, and nothing else.

### T5 — Data mode A: sanitized prod snapshot

Export (run from the prod subscription, needs `femme-sql-admins`):

- [ ] Create a temporary point-in-time copy of the prod DB with `az sql db restore`, so the
      export doesn't load the 5-DTU live database.
- [ ] Export it with `sqlpackage /Action:Export /AccessToken:<entra token>`. SQL is Entra-only,
      so `az sql db export` (SQL auth) won't work.
- [ ] Write it to a **persistent, private** storage account **outside** the disposable RG, e.g.
      `femme-staging-data-rg` / `stfemmestagingdata`:
  - container `snapshots/`, private, no public access
  - RBAC limited to `femme-sql-admins`
  - lifecycle rule that deletes prod snapshots after N days
- [ ] Delete the temporary copy.

Import (run from `up.sh`):

- [ ] `sqlpackage /Action:Import /AccessToken:…` into the empty `femme_app_db`, before the
      backend image first starts.
- [ ] Run `scripts/staging/sanitize-prod-snapshot.sql`. It is **mandatory**; `up.sh` refuses to
      deploy if it didn't run:
  - `DROP USER [femme-backend]`: the imported user carries the **prod** managed identity SID.
    Re-create it `FROM EXTERNAL PROVIDER` (step 4 of `up.sh`).
  - Rewrite every client and app-user **email** to a safe value (e.g.
    `staging+<id>@<team-controlled domain>`) and every **phone** to a dummy. This keeps
    `AppointmentReminderScheduler` and the KuDE/cancellation emails from reaching real people.
  - Replace **all password hashes**; set a known staging password on an agreed list of
    test accounts.
  - Delete all `sifen_certificates` rows: their Key Vault refs point at the prod vault, and
    staging must not sign as a real taxpayer.
  - Mark pending `commission_outbox` / `stock_outbox` rows and pending SIFEN submissions as
    processed/void, so the reconcilers don't replay them.
  - Invalidate activation and password-reset tokens.
- [ ] On boot, Flyway applies the new release's migrations to real prod data. **This is a
      migration rehearsal:** record its duration and any errors in the test report.

**Acceptance:**
- No row in staging contains a real client email or phone (a query check in `up.sh`).
- The test accounts can log in.
- Flyway reaches the release's version.

> PII note: prod data is copied into the dev subscription. Access to `femme-staging-data-rg`
> and `femme-staging-rg` must stay limited to `femme-sql-admins`. Snapshots expire automatically.

### T6 — Data mode B: multi-tenant load-test golden DB

- [ ] Generator under `loadtest/seed/`:
  - creates tenants, admin users, professionals, services and schedules through the **real
    Platform Admin and tenant APIs**, reusing the provisioning pattern in
    `e2e/global-setup.mt.ts`, so the data is valid by construction
  - then bulk-generates history as SQL for speed: clients, appointments, fichas
    (service records), invoices (TEST SIFEN state), cash sessions/movements, tips
- [ ] Size profiles:
  - `small`: about 10 tenants
  - `target`: about 100 tenants, matching the 10→100 client cost projection

  Per-tenant volumes come from prod averages, measured with a query on a T5 snapshot (no prod
  data is copied).
- [ ] Must fit under the **Basic 2 GB** cap with headroom. Record the final size.
- [ ] Export as `loadtest/loadtest-V<flyway version>-<profile>.bacpac` into the same storage
      account (no expiry). Regenerate after major schema changes; otherwise Flyway migrates it
      forward on boot.
- [ ] Publish the test users and passwords for each profile, so k6 can use them.

**Acceptance:** `up.sh --data=loadtest --bacpac=<name>` brings up N tenants where every one can
log in and shows populated agenda, fichas and billing.

### T7 — Load testing

- [ ] k6 scenarios in `loadtest/scenarios/`:
  - login and session refresh
  - agenda/calendar reads
  - create and edit appointment
  - save ficha
  - client search
  - invoice list and Historial report (xlsx/pdf)
  - dashboard

  Users and tenants are spread across the golden DB.
- [ ] SIFEN issuance is excluded or tightly throttled, since it calls the external `sifen-test`
      endpoint.
- [ ] Runner: GH Actions `workflow_dispatch` (`loadtest.yml`) on a hosted runner. Azure Load
      Testing is an option for higher volumes.
- [ ] Thresholds: p95 latency per endpoint and error rate.
- [ ] Results template under `loadtest/reports/`. It covers:
  - k6 summary
  - from the "Femme - Infra (staging)" workbook: CPU, working-set memory, replica count, restarts
  - SQL DTU % and storage
  - cold-start time
- [ ] Rules:
  - `max_replicas = 1` and SQL Basic 5 DTU **are the prod limits being measured**. Expect the DB
    or the single replica to saturate first; that is the finding.
  - "What-if" runs with different sizing are allowed only as an explicitly labeled, temporary
    override (`-var` on the apply), recorded in the report, and never committed to the staging
    tfvars.
  - Run inside the wake window (07–20 Mon–Sat, Asunción), or account for scale-to-zero cold
    starts, as in prod.

**Acceptance:** a run against `small` produces a report with all of the metrics above.

### T8 — Docs & runbook

- [ ] Add a "Staging" section to `infrastructure_v2/infrastructure_v2.md`: lifecycle, data modes
      and safeguards. Link it to this file.
- [ ] Add a short "how to test a release in staging" checklist to this doc after the first real
      use.

## 4. Recreate workflow

**Release candidate on prod data** (expected ≈ 30–45 min):

1. Export a fresh prod snapshot (T5 export).
2. `scripts/staging/up.sh --recreate --data=prod --ref=<release branch>`
3. Run the regression smoke checks and measure the migration time.
4. Make the go/no-go call for prod.
5. `scripts/staging/down.sh`

**Load test** (expected ≈ 30 min to set up):

1. `scripts/staging/up.sh --recreate --data=loadtest --bacpac=<golden> --ref=<ref>`
2. Run `loadtest.yml`.
3. Collect the report.
4. `scripts/staging/down.sh`

**Torn-down checklist:**

- [ ] `az group show -n femme-staging-rg` → not found
- [ ] `az keyvault list-deleted` → no `femme-kv-*` from staging
- [ ] `v2-staging` secrets cleared
- [ ] Temporary prod PITR copy deleted

## 5. Cost

Staging costs roughly the same as prod for the time it exists: about $17/month baseline, so
≈ $0.55/day. The wake schedule keeps one replica up about 13 h/day, Mon–Sat, so **tear it down
when idle**. During load tests, Log Analytics may hit the 0.5 GB/day cap; when it does, the
workbooks go blank for the rest of the day. That is the same behavior as prod, so plan the test
windows around it. The persistent BACPAC storage account costs pennies.

## 6. Risks & safeguards

| Risk | Safeguard |
|---|---|
| Staging destroy unregisters `Microsoft.App` / `Microsoft.Communication` and breaks dev | `manage_resource_providers = false` (T1) |
| Reminders or invoice emails reach real customers from prod data | Mandatory sanitization (T5); `up.sh` verifies it before deploying |
| Fiscal documents sent to real SIFEN | `sifen_environment = TEST` enforced by T2 and `up.sh`; certificates deleted |
| Prod PII or password hashes left exposed | Hashes replaced, contacts rewritten, snapshots private and expiring, RBAC limited |
| Calls to the real Stock system | No `stock_api_base_url`, so `STOCK_NOT_CONFIGURED`; outbox voided |
| Staging silently drifts from prod sizing | T2 tfvars check + live prod check in `up.sh` |
| Key Vault name collision on recreate | `random_string` suffix is regenerated per state; `down.sh` purges |
| CI loses rights when the RG is recreated | Subscription-scope role, or re-grant in `up.sh` (T4) |
| First revision crash-loops after apply | Expected while RBAC propagates; `up.sh` waits and retries the smoke test |
| `deployer_ip` changes | Same variable as dev; update before running `up.sh` |
| Basic 2 GB cap exceeded by the golden DB | Size budget per profile (T6) |

## 7. Open decisions

1. Sanitization details: target domain for rewritten emails, and which accounts get a known
   password.
2. Load-test profiles: exact tenant count and per-tenant volumes for `target`.
3. k6 on GH Actions vs Azure Load Testing.
4. Whether `v2-staging` deploys need a required reviewer.
5. Retention (N days) for prod snapshots in `femme-staging-data-rg`.
