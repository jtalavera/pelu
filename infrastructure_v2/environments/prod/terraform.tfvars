# Production environment — subscription 9e394b80…
# Deploys on merge to main via .github/workflows/deploy-v2.yml → GitHub Environment: v2-production

subscription_id = "9e394b80-19d1-4187-8382-31d052ffd540"

environment         = "prod"
name_prefix         = "femme"
location            = "eastus2"
sql_server_location = "centralus"

# Operator IP allowed through the SQL firewall for manual admin tasks.
deployer_ip = "181.91.85.175"  # TODO: update if the prod deployer machine has a different IP

# Entra ID group (recommended) or user to set as the SQL Entra administrator.
# After apply, connect as this principal to run the managed-identity DB user grant.
entra_sql_admin_login     = "femme-sql-admins"
entra_sql_admin_object_id = "53c652ae-0159-4a39-9a38-b7444c89156e"

backend_min_replicas = 0
backend_max_replicas = 1

# Zone-redundant PITR backups — protects restores from a single-AZ failure.
# The DB itself is non-zonal so the SQL free-limit grant is kept.
sql_backup_storage_redundancy = "Zone"

log_analytics_daily_quota_gb = 0.5
