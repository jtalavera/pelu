# Staging environment — disposable, prod-parity (docs/staging-env.md). Subscription 677a6eab…
# (same as dev), resource group femme-staging-rg. Created and destroyed only by
# scripts/staging/up.sh / down.sh; deployed only on demand (deploy-v2.yml → GitHub Environment
# v2-staging).
#
# PARITY RULE: every value below that affects performance, cost or scale is a copy of
# environments/prod/terraform.tfvars (or of the variable default prod relies on).
# scripts/staging/check-parity.sh fails CI on any difference not in its allowlist (§2.2 of the
# plan), so a prod sizing change must be mirrored here in the same PR.

# --- Allowed deviations (§2.2) -------------------------------------------------------------

subscription_id = "677a6eab-1283-48ee-a110-f40cf4a6df42"
environment     = "staging"

# Staging must never send real fiscal documents. up.sh aborts if this is not TEST.
sifen_environment = "TEST"

# Disposable vault: must be purgeable by down.sh. purge protection is irreversible.
key_vault_soft_delete_retention_days = 7
key_vault_purge_protection_enabled   = false

# flowbit.tech belongs to prod: no frontend_custom_domains, no website_* here.

# The dev state owns the subscription's Microsoft.App / Microsoft.Communication registrations.
manage_resource_providers = false

# femme-cicd-v2-test service principal (object id). Contributor on femme-staging-rg, recreated
# with the RG on every apply (T4).
ci_deployer_principal_id = "828b6a77-bbe6-459d-9b7b-a9cf8297d81d"

# Same operator/admin values as dev. up.sh overrides deployer_ip with the operator's current
# public IP (-var) when it differs.
deployer_ip               = "181.91.85.175"
entra_sql_admin_login     = "femme-sql-admins"
entra_sql_admin_object_id = "53c652ae-0159-4a39-9a38-b7444c89156e"

# --- Must match prod (§2.1) -----------------------------------------------------------------

name_prefix         = "femme"
location            = "centralus"
sql_server_location = ""

backend_min_replicas = 0
backend_max_replicas = 1

# Same wake window as prod (07:00-20:00 Mon-Sat, America/Asuncion, 1 replica — variable
# defaults). Load tests run inside it, or account for cold starts as prod does.
backend_wake_schedule_enabled = true

# backend_report_warmup_enabled: NOT set — prod relies on the default (true). Dev overrides it
# to false; staging must not.

sql_backup_storage_redundancy = "Zone"

log_analytics_daily_quota_gb = 0.5

# ACS email: prod sets no email_custom_domain → AzureManaged sender domain. Same here.

# Stock: enabled with no base URL → STOCK_NOT_CONFIGURED, nothing is sent (same as prod).
stock_enabled = true
