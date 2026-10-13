# Production environment — subscription 9e394b80…
# Deploys on merge to main via .github/workflows/deploy-v2.yml → GitHub Environment: v2-production

subscription_id = "9e394b80-19d1-4187-8382-31d052ffd540"

environment         = "prod"
name_prefix         = "femme"
location            = "centralus"
sql_server_location = ""

# Operator IP allowed through the SQL firewall for manual admin tasks.
deployer_ip = "181.91.85.175" # TODO: update if the prod deployer machine has a different IP

# Entra ID group (recommended) or user to set as the SQL Entra administrator.
# After apply, connect as this principal to run the managed-identity DB user grant.
entra_sql_admin_login     = "femme-sql-admins"
entra_sql_admin_object_id = "53c652ae-0159-4a39-9a38-b7444c89156e"

backend_min_replicas = 0
backend_max_replicas = 1

# Keep the backend warm 07:00-20:00, Monday-Saturday (America/Asuncion) so the
# first customer each day doesn't hit a cold start; scales to zero outside
# this window and on Sundays.
backend_wake_schedule_enabled = true

# Zone-redundant PITR backups — protects restores from a single-AZ failure.
# The DB itself is non-zonal so the SQL free-limit grant is kept.
sql_backup_storage_redundancy = "Zone"

log_analytics_daily_quota_gb = 0.5

# Custom domains on the pelu Static Web App (registered by Terraform; DNS records are manual at
# the external DNS provider) and allowed CORS origins on the backend. The apex was created in the
# Portal, so import it before the first apply (see main.tf).
frontend_custom_domains = ["flowbit.tech"]

# www.flowbit.tech serves the marketing website SWA (rg-flowbit-website), not pelu. Cut-over
# order: CNAME www -> white-tree-008be3e10.2.azurestaticapps.net, remove www from the pelu SWA,
# then apply.
website_swa_name           = "swa-flowbit-website"
website_swa_resource_group = "rg-flowbit-website"
website_custom_domain      = "www.flowbit.tech"

# RT-12 (Hardening_SIFEN.md): the vault holds fiscal signing keys — 90-day retention and
# purge_protection_enabled=true are correct here. NOTE: purge_protection_enabled is IRREVERSIBLE
# once applied; the vault can never be purged before the retention window elapses, even by an
# owner. Confirm this is genuinely wanted before the first apply in prod.
key_vault_soft_delete_retention_days = 90
key_vault_purge_protection_enabled   = true

# SIFEN: production taxpayers' documents go to sifen.set.gov.py (backend default is TEST).
sifen_environment = "PRODUCTION"

# Stock integration (HU-59..HU-67). Prepared ahead of the production control-stock: the queue, roles
# and env vars exist, and with no stock_api_base_url the backend reports STOCK_NOT_CONFIGURED (and
# STOCK_MODULE is OFF for every tenant), so nothing is sent. When Stock is deployed, set
# stock_api_base_url = "<Stock prod API URL>" and `terraform apply`, then follow the "Stock
# integration" runbook in infrastructure_v2/infrastructure_v2.md (remaining Key Vault secret and the
# VITE_STOCK_SPA_URL GitHub variable are not managed by Terraform).
stock_enabled = true
# stock_api_base_url = ""
