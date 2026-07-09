# Test/dev environment — subscription 677a6eab…
# Deploys on merge to develop via .github/workflows/deploy-v2.yml → GitHub Environment: v2-test

subscription_id = "677a6eab-1283-48ee-a110-f40cf4a6df42"

environment         = "test"
name_prefix         = "femme"
location            = "centralus"
sql_server_location = ""

# Operator IP allowed through the SQL firewall for manual admin tasks.
deployer_ip = "181.91.85.175"

# Entra ID group (recommended) or user to set as the SQL Entra administrator.
# After apply, connect as this principal to run the managed-identity DB user grant.
entra_sql_admin_login     = "femme-sql-admins"
entra_sql_admin_object_id = "53c652ae-0159-4a39-9a38-b7444c89156e"

backend_min_replicas = 0
backend_max_replicas = 1

# No redundancy for test — cheapest option; restore from PITR if needed.
sql_backup_storage_redundancy = "Local"

log_analytics_daily_quota_gb = 0.5
