# Infrastructure v2

Cost-optimised two-environment Azure stack for Femme/Pelu.

## Architecture

```
Browser
  ├── Azure Static Web App (Free) ─────────────── React SPA
  └── Azure Container App (Consumption)  ──────── Spring Boot :8080
        │  system-assigned managed identity
        ├── Azure SQL Database (serverless, auto-pause)
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

**During migration:** the existing v1 pipeline (`ci.yml`) continues deploying to v1
on push to `main`. Both pipelines run in parallel until v2 is validated.

## Estimated monthly cost

| Service | Test | Prod |
|---|---|---|
| Static Web App (Free) | $0 | $0 |
| Container App (min 0, 0.25 vCPU / 0.5 GiB) | $0–2 | $0–2 |
| Azure SQL (serverless GP_S_Gen5_1, auto-pause, free limit) | $0 | $0–5 |
| SQL backup storage (Local / Zone) | $0–1 | $1–3 |
| Log Analytics (0.5 GB/day cap) | $0–3 | $0–3 |
| Application Insights (workspace-based) | $0–2 | $0–2 |
| Communication Services (email) | $0–1 | $0–1 |
| **Total** | **≈ $0–5** | **≈ $5–15** |

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

## Retiring v1 (future)

Once v2 is validated:
1. Remove the `deploy` job from `.github/workflows/ci.yml`.
2. Leave the v1 Azure resources running until traffic is confirmed on v2.
3. Destroy v1 with `cd infrastructure/terraform && terraform destroy`.
