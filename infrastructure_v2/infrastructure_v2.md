# Infrastructure v2

Cost-optimised two-environment Azure stack for Femme/Pelu.

## Architecture

```
Browser
  ├── Azure Static Web App (Free) ─────────────── React SPA
  └── Azure Container App (Consumption)  ──────── Spring Boot :8080
        │  system-assigned managed identity
        ├── Azure SQL Database (Basic tier)
        ├── Azure Communication Services (email)
        └── Application Insights / Log Analytics
```

## Environments

| Environment | Branch | Subscription | GitHub Environment |
|---|---|---|---|
| test | `develop` | `677a6eab-…` | `v2-test` |
| prod | `main` | `9e394b80-…` | `v2-production` |

Both environments run from this single root module with per-environment
`environments/<env>/backend.hcl` + `environments/<env>/terraform.tfvars`.

This is now the sole deploy pipeline — the legacy v1 pipeline and its Terraform
code (`infrastructure/`, `ci.yml`) have been retired.

## Estimated monthly cost

| Service | Test | Prod |
|---|---|---|
| Static Web App (Free) | $0 | $0 |
| Container App (min 0, 0.25 vCPU / 0.5 GiB) | $0–2 | $0–2 |
| Azure SQL (Basic tier, 5 DTU / 2 GB, no auto-pause) | ≈ $5 | ≈ $5 |
| SQL backup storage (Local / Zone) | $0–1 | $1–3 |
| Log Analytics (0.5 GB/day cap) | $0–3 | $0–3 |
| Application Insights (workspace-based) | $0–2 | $0–2 |
| Communication Services (email) | $0–1 | $0–1 |
| **Total** | **≈ $5–11** | **≈ $9–14** |

## Applying per environment

```bash
cd infrastructure_v2/

# Test
terraform init -backend-config=environments/dev/backend.hcl
terraform plan  -var-file=environments/dev/terraform.tfvars
terraform apply -var-file=environments/dev/terraform.tfvars

# Prod
terraform init  -reconfigure -backend-config=environments/prod/backend.hcl
terraform plan  -var-file=environments/prod/terraform.tfvars
terraform apply -var-file=environments/prod/terraform.tfvars
```

`-reconfigure` is needed when switching between environments on the same machine
(Terraform resets the local backend pointer).

## One-time bootstrap (before first `terraform init`)

### 1. Remote state storage

Each environment needs its own Azure Storage Account for Terraform state.

**Test** (already exists):
```
rg-terraform-state-dev / sttfstatedev3tfruqf0 / tfstate
```

**Prod** (create first):
```bash
# Run as a user with Owner or Contributor on the prod subscription
RESOURCE_GROUP="rg-terraform-state-prod"
STORAGE_ACCOUNT="sttfstateprod$(openssl rand -hex 5)"   # unique name
CONTAINER="tfstate"
LOCATION="eastus2"

az group create -n "$RESOURCE_GROUP" -l "$LOCATION"
az storage account create -n "$STORAGE_ACCOUNT" -g "$RESOURCE_GROUP" \
  -l "$LOCATION" --sku Standard_LRS --min-tls-version TLS1_2
az storage container create -n "$CONTAINER" \
  --account-name "$STORAGE_ACCOUNT"

echo "storage_account_name = \"$STORAGE_ACCOUNT\""
# Paste this value into environments/prod/backend.hcl
```

### 2. OIDC app registrations for CI/CD (one per subscription)

Create an Azure AD app + service principal with **Contributor** on the environment's
resource group, then add federated credentials for the workflows that deploy to it:

| Subject | Used by |
|---|---|
| `repo:OWNER/REPO:ref:refs/heads/develop` | push to develop → deploy-v2.yml |
| `repo:OWNER/REPO:ref:refs/heads/main` | push to main → deploy-v2.yml |
| `repo:OWNER/REPO:environment:v2-test` | job environment in deploy-v2.yml |
| `repo:OWNER/REPO:environment:v2-production` | job environment in deploy-v2.yml |

Store `clientId`, `tenantId`, and `subscriptionId` as secrets in the
corresponding GitHub Environment (`v2-test` / `v2-production`).

### 3. Entra SQL administrator

Create (or identify) an Entra ID group in `flowbittech.onmicrosoft.com` whose
members can manage the SQL database. Fill in `entra_sql_admin_login` and
`entra_sql_admin_object_id` in both `terraform.tfvars` files.

## Post-apply: grant the managed identity as a SQL DB user

After the first `terraform apply`, the Container App has a system-assigned
managed identity but cannot yet connect to SQL. Run this once per environment:

```bash
# Connect to the SQL server as the Entra admin (or a member of the admin group)
CONTAINER_APP_NAME="femme-backend"   # matches name_prefix + "-backend" in main.tf
SERVER_FQDN="<terraform output -raw sql_server_fqdn>"
DB_NAME="<terraform output -raw sql_database_name>"

sqlcmd -S "$SERVER_FQDN" -d "$DB_NAME" \
  --authentication-method=ActiveDirectoryInteractive \
  -Q "
    CREATE USER [$CONTAINER_APP_NAME] FROM EXTERNAL PROVIDER;
    ALTER ROLE db_datareader  ADD MEMBER [$CONTAINER_APP_NAME];
    ALTER ROLE db_datawriter  ADD MEMBER [$CONTAINER_APP_NAME];
    ALTER ROLE db_ddladmin    ADD MEMBER [$CONTAINER_APP_NAME];
  "
```

`db_ddladmin` is required so Flyway can run migrations on startup.

## Post-apply: seed the Key Vault JWT secret (RT-12/RT-18)

After the first `terraform apply` that includes the Key Vault, the backend expects
`app-femme-jwt-secret` to already exist — it fetches this at boot
(`KeyVaultSecretsEnvironmentPostProcessor`) and **fails to start if it's missing**. Seed it
**before** deploying a backend image built from this story, using the *current* effective JWT
secret value (whatever `FEMME_JWT_SECRET` was set to previously, or the hardcoded dev default if
it was never overridden) — this migrates the value verbatim and rotates nothing, so no active
session is invalidated. Any *later* rotation (a genuinely new value) does invalidate every active
session — expected, not a bug.

```bash
KEY_VAULT_NAME="<terraform output -raw key_vault_name>"
az keyvault secret set --vault-name "$KEY_VAULT_NAME" --name app-femme-jwt-secret \
  --value "<the current JWT secret value>"
```

Requires the "Key Vault Secrets Officer" role on the vault — already granted by Terraform to
`entra_sql_admin_object_id` (see `azurerm_role_assignment.deployer_kv_secrets_officer`).

**Expect the first revision after a fresh apply to crash-loop for a few minutes** while the
Container App's "Key Vault Secrets Officer" role assignment propagates through Entra RBAC — this
is normal, not a sign anything is misconfigured.

**RT-17 — every tenant with a SIFEN certificate must re-upload it.** The migration that moves
certificate storage to Key Vault (`V34__sifen_certificates_keyvault_refs.sql`) deletes existing
`sifen_certificates` rows — there is deliberately no automated migration script (see the
migration's own header comment and RT-17 in `Hardening_SIFEN.md` for why). **Coordinate with every
tenant that has a certificate uploaded before applying this migration in an environment with real
tenant data** — after it runs, `SIFEN_ELECTRONIC_INVOICING` tenants cannot issue an invoice until
they re-upload via the existing certificate screen (`InvoiceController.issue` blocks on
`SIFEN_NO_VALID_CERTIFICATE` otherwise). Check the blast radius first:

```sql
SELECT tenant_id, COUNT(*) FROM sifen_certificates GROUP BY tenant_id;
```

## Operational notes: Service Bus (RT-20)

- **Scale-to-zero and the queue consumer.** `SifenSubmissionQueueListener` (the Service Bus
  consumer) runs *inside* the backend Container App. Both environments keep
  `backend_min_replicas = 0` — a deliberate decision, not an oversight — so while the container is
  scaled to zero, queued invoices are not transmitted until an unrelated HTTP request wakes it, or
  until prod's wake schedule (07:00–20:00 Mon–Sat, `backend_wake_schedule_enabled`) brings it up.
  `SifenSubmissionReconciler` (the retry/safety-net job) only runs while the app is alive, same as
  everything else in the JVM — it does not itself keep the container awake. Outside those hours,
  transmission latency for a queued invoice is bounded only by the next request that happens to
  arrive. If this latency becomes a real problem, the fix is `backend_min_replicas = 1` for
  SIFEN-enabled environments (an always-on cost) or a KEDA `azure-servicebus` scale rule — neither
  is wired up here.
- **Dead-letter queue.** A message lands in the DLQ (`sifen-submission/$deadletterqueue`) either
  because the consumer classified the failure as terminal (see `SifenSubmissionQueueListener`'s
  `Outcome.DEAD_LETTERED`) or because `max_delivery_count` (6) was exceeded. Per RT-20: an invoice
  in the DLQ is a fiscal document the app has given up on resolving by itself — it needs a human to
  look at it. No automated alert is wired up in this Terraform (there's no existing action
  group/alerting pipeline in this stack to hook into yet); until one exists, check manually:
  ```bash
  az servicebus queue show --resource-group <rg> --namespace-name <namespace-from-service_bus_namespace-output> \
    --name sifen-submission --query countDetails.deadLetterMessageCount
  ```

## SQL free-limit grant (not enabled — known limitation)

Azure grants one serverless General Purpose database per subscription up to
100,000 free vCore-seconds (~27.7 vCore-hours) and 32GB storage per month via
`useFreeLimit`. This was investigated but **cannot be applied to these
databases**: Azure rejects converting an already-provisioned "paid" database
to the free tier (`ProvisioningDisabled: Cannot update paid database to free
database`), via both the ARM API directly and `az sql db update`. The free
offer can only be selected at database creation. Recreating the databases to
pick it up isn't worth the risk to live data for the ~$15/month it would
save. If this ever needs revisiting, it would require a new database created
with `useFreeLimit` set from the start (and a data migration), not a
Terraform/CLI update to the existing one.

## GitHub Environments (configure in GitHub repo settings)

Create two environments — **v2-test** and **v2-production** — each with:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | App registration client ID for OIDC login |
| `AZURE_TENANT_ID` | `flowbittech.onmicrosoft.com` tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Target subscription (`677a6eab…` / `9e394b80…`) |
| `AZURE_CONTAINER_APP_NAME` | Name of the Container App (e.g. `femme-backend`) |
| `AZURE_RESOURCE_GROUP_NAME` | Resource group name (e.g. `femme-test-rg`) |
| `VITE_API_BASE_URL` | Backend FQDN (`terraform output -raw container_app_fqdn`) |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | `terraform output -raw static_web_app_api_key` |
| `GHCR_USERNAME` *(optional)* | GitHub username for private GHCR pulls |
| `GHCR_READ_PACKAGES_PAT` *(optional)* | PAT with `read:packages` scope |

And one environment **variable** (Settings → Environments → Variables, not a secret):

| Variable | Description |
|---|---|
| `VITE_APPINSIGHTS_CONNECTION_STRING` | Browser RUM (issue #268): `terraform output -raw app_insights_connection_string`. Unset → frontend telemetry stays off. |

## Observability (issue #268)

Backend and frontend both report to the env's single Application Insights resource
(`azurerm_application_insights.main`), told apart by `cloud_RoleName`:
`femme-backend` / `femme-frontend`.

- **Backend.** The Application Insights Java agent is baked into the image and attached via
  `-javaagent`. See `src/backend/Dockerfile` and `src/backend/applicationinsights.json`.
  - It auto-captures requests, JDBC/HTTP/Service Bus dependencies, exceptions and logs.
  - Custom metrics come from `SifenCallMetrics` (`sifen.operation`) and `BusinessMetrics`
    (`femme.*`) through the OpenTelemetry API.
  - Sampling is rate-limited to 5 req/s.
  - The captured log level is `var.backend_ai_logging_level` (default `INFO`).
- **Frontend.** `src/frontend/src/telemetry/appInsights.ts` uses W3C `traceparent` correlation,
  so one `operation_Id` spans browser → API → SQL.
- **Workbooks.** Terraform-managed, from `workbooks/*.json.tftpl`. In the Portal: Application
  Insights → Workbooks.
  - "Femme - Infra (<env>)": ops health, aggregate.
  - "Femme - Business (<env>)": filterable by tenant ID.
  - The templates are plain workbook JSON (`Notebook/1.0`) with `${...}` placeholders for resource
    IDs. Keep KQL free of `${`/`%{` so `templatefile()` doesn't interpret it.

Rollout checklist (per env, dev first):

1. `terraform apply`. This adds the 2 workbooks, the Container App metrics diagnostic setting, and
   the agent log-level env var.
2. Set the frontend variable:
   `gh variable set VITE_APPINSIGHTS_CONNECTION_STRING --env v2-test --body "$(terraform output -raw app_insights_connection_string)"`.
3. Merge/deploy. The next backend image carries the agent, and the next frontend build carries
   RUM.
4. **Memory/CPU headroom.** The agent adds heap, metaspace and startup CPU on a 0.5 vCPU / 1Gi
   container. Watch `WorkingSetBytes`, restarts and cold-start time on the Infra workbook.
   Levers:
   - lower `sampling.requestsPerSecond` in `applicationinsights.json`
   - lower `backend_ai_logging_level` (e.g. `WARN`)
   - reduce `-XX:MaxRAMPercentage`
5. **Ingestion cap.** Leave `log_analytics_daily_quota_gb` as is at first. After ~1 week in dev,
   read the real volume, then set explicit dev/prod values:
   `Usage | where TimeGenerated > ago(7d) | summarize GB = sum(Quantity) / 1024 by DataType, bin(TimeGenerated, 1d)`.
   When the cap is hit, ingestion stops for the rest of the day, so the workbooks go blank.

## DR runbook (RTO 1h / RPO 10 min)

- **RPO 10 min** — Azure SQL automatic PITR (transaction-log backups every ~5–10 min),
  7-day retention. Prod backups use Zone-redundant storage so a single AZ failure
  does not affect restore capability.
- **RTO 1h** — in the event of a full environment loss:
  1. `terraform apply` to recreate resources in the same or a new region.
  2. `az containerapp update --image` to re-point to the last GHCR image.
  3. Azure SQL point-in-time restore to recover data.
  4. Re-run the managed-identity DB user grant (see above).
  5. Update `VITE_API_BASE_URL` and re-deploy frontend if FQDNs changed.

## v1 retirement (done)

v1 has been fully retired: `.github/workflows/ci.yml` and the `infrastructure/`
Terraform code were removed once v2 traffic was confirmed and the v1 Azure
resources were decommissioned.
