resource "random_string" "suffix" {
  length  = 6
  lower   = true
  special = false
  upper   = false
}

# RT-12/RT-18 (Hardening_SIFEN.md): the tenant this deployment's credentials belong to, needed to
# create the Key Vault (Entra tenant ID, not this app's own multi-tenant "tenant" concept).
data "azurerm_client_config" "current" {}

# ---------------------------------------------------------------------------
# Locals
# ---------------------------------------------------------------------------

locals {
  # SQL can be deployed in a different region if the subscription blocks Azure SQL
  # in `location` (ProvisioningDisabled).
  sql_location = trimspace(var.sql_server_location) != "" ? var.sql_server_location : var.location

  sql_fqdn = azurerm_mssql_server.main.fully_qualified_domain_name
  sql_db   = azurerm_mssql_database.app.name

  # Passwordless JDBC URL — no username/password; the Container App's system-assigned
  # managed identity authenticates via ActiveDirectoryMSI.
  jdbc_url = format(
    "jdbc:sqlserver://%s:1433;databaseName=%s;encrypt=true;trustServerCertificate=false;hostNameInCertificate=*.database.windows.net;loginTimeout=30;Authentication=ActiveDirectoryMSI",
    local.sql_fqdn,
    local.sql_db
  )

  # Comma-separated origins for CORS: the SWA default host plus any custom domains
  # already registered on the Static Web App outside Terraform (var.frontend_custom_domains).
  frontend_allowed_origins = join(",", concat(
    ["https://${azurerm_static_web_app.frontend.default_host_name}"],
    [for d in var.frontend_custom_domains : "https://${d}"]
  ))
  acs_sender_address = "DoNotReply@${azurerm_email_communication_service_domain.main.from_sender_domain}"

  # Tags applied to every resource. Additional tags can be passed via var.tags.
  tags = merge({
    Environment = var.environment
    ManagedBy   = "terraform"
  }, var.tags)
}

# ---------------------------------------------------------------------------
# Resource provider registrations (one-time per subscription)
# ---------------------------------------------------------------------------

# Required for Container Apps (Microsoft.App).
resource "azurerm_resource_provider_registration" "app" {
  name = "Microsoft.App"
}

# Required for Azure Communication Services.
resource "azurerm_resource_provider_registration" "communication" {
  name = "Microsoft.Communication"
}

# ---------------------------------------------------------------------------
# Resource group
# ---------------------------------------------------------------------------

resource "azurerm_resource_group" "main" {
  name     = "${var.name_prefix}-${var.environment}-rg"
  location = var.location
  tags     = local.tags
}

# ---------------------------------------------------------------------------
# Observability — Log Analytics + Application Insights
# ---------------------------------------------------------------------------

resource "azurerm_log_analytics_workspace" "main" {
  name                = "${var.name_prefix}-logs-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  # Daily cap prevents runaway cost; adjust via var.log_analytics_daily_quota_gb.
  daily_quota_gb = var.log_analytics_daily_quota_gb
  tags           = local.tags
}

resource "azurerm_application_insights" "main" {
  name                = "${var.name_prefix}-ai-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  workspace_id        = azurerm_log_analytics_workspace.main.id
  application_type    = "web"
  retention_in_days   = 30
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# Frontend — Azure Static Web Apps (Free)
# ---------------------------------------------------------------------------

resource "azurerm_static_web_app" "frontend" {
  name                = "${var.name_prefix}-swa-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
}

# ---------------------------------------------------------------------------
# Database — Azure SQL Server + Serverless Database
# ---------------------------------------------------------------------------

resource "azurerm_mssql_server" "main" {
  name                          = "${var.name_prefix}sql${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = local.sql_location
  version                       = "12.0"
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true

  # Entra-only authentication: no SQL login/password exists.
  # The Container App connects via its system-assigned managed identity.
  azuread_administrator {
    login_username              = var.entra_sql_admin_login
    object_id                   = var.entra_sql_admin_object_id
    azuread_authentication_only = true
  }

  tags = local.tags
}

# Allow connections from other Azure services (required — Container Apps have no VNet).
resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Allow the operator/deployer machine for manual SQL admin tasks.
resource "azurerm_mssql_firewall_rule" "deployer" {
  name             = "AllowDeployer"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = var.deployer_ip
  end_ip_address   = var.deployer_ip
}

resource "azurerm_mssql_database" "app" {
  name      = "${var.name_prefix}_app_db"
  server_id = azurerm_mssql_server.main.id
  collation = "SQL_Latin1_General_CP1_CI_AS"

  # Basic tier: fixed 5 DTU, 2 GB max size, no auto-pause. Matches what's
  # actually deployed — set manually in the Portal in both environments as a
  # cost-mitigation stopgap during the useSessionRefresh 401 retry-loop
  # incident, and kept afterward. Terraform now reflects reality rather than
  # reverting the live databases back to serverless.
  sku_name = "Basic"

  # test: Local (cheapest). prod: Zone (zone-resilient PITR backups).
  storage_account_type = var.sql_backup_storage_redundancy

  tags = local.tags
}

resource "azurerm_mssql_server_extended_auditing_policy" "main" {
  server_id                               = azurerm_mssql_server.main.id
  log_monitoring_enabled                  = true
  storage_endpoint                        = null
  storage_account_access_key              = null
  storage_account_access_key_is_secondary = false
  retention_in_days                       = 0
}

# ---------------------------------------------------------------------------
# Azure Communication Services — email
# ---------------------------------------------------------------------------

resource "azurerm_email_communication_service" "main" {
  name                = "${var.name_prefix}-email-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = "United States"
  tags                = local.tags

  depends_on = [azurerm_resource_provider_registration.communication]
}

resource "azurerm_email_communication_service_domain" "main" {
  name              = "AzureManagedDomain"
  email_service_id  = azurerm_email_communication_service.main.id
  domain_management = "AzureManaged"
}

resource "azurerm_communication_service" "main" {
  name                = "${var.name_prefix}-acs-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = "United States"
  tags                = local.tags

  depends_on = [azurerm_resource_provider_registration.communication]
}

resource "azurerm_communication_service_email_domain_association" "main" {
  communication_service_id = azurerm_communication_service.main.id
  email_service_domain_id  = azurerm_email_communication_service_domain.main.id
}

# ---------------------------------------------------------------------------
# Key Vault — RT-12/RT-13/RT-18 (Hardening_SIFEN.md): per-tenant SIFEN certificate secrets
# (.p12 + password, one pair per tenant, see KeyVaultSifenCertificateSecretStore) and the
# app-wide JWT signing secret (see KeyVaultSecretsEnvironmentPostProcessor). RBAC authorization
# only — no access policies, no SAS/connection-string auth. Write-only in this PR: apply per
# environment when ready (see infrastructure_v2.md post-apply steps for what has to happen
# immediately after, including a manual re-upload of every tenant's SIFEN certificate — RT-17).
# ---------------------------------------------------------------------------

# purge_protection_enabled below is deliberately environment-conditional
# (environments/dev|prod/terraform.tfvars): dev runs with it off so the vault is cheap to tear
# down, prod always sets it true. Semgrep can't evaluate the variable statically, so it flags this
# every time regardless of which environment applies — suppressed with justification below.
#
# network_acls default_action is "Allow" rather than "Deny": Container Apps is not on Key
# Vault's trusted-services bypass list, and this app runs outside a VNet, so a "Deny" default
# would block the backend's own data-plane calls regardless of its RBAC grant. Access control
# here is RBAC + Managed Identity by design, not network isolation — also suppressed below.
resource "azurerm_key_vault" "main" { # nosemgrep: terraform.azure.security.keyvault.keyvault-purge-enabled.keyvault-purge-enabled, terraform.azure.security.keyvault.keyvault-specify-network-acl.keyvault-specify-network-acl
  name                = "${var.name_prefix}-kv-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"

  rbac_authorization_enabled = true

  # test: 7 days + no purge protection, cheap to tear down. prod: 90 days + purge protection is
  # IRREVERSIBLE once applied (a vault holding fiscal signing keys should not be purgeable).
  soft_delete_retention_days = var.key_vault_soft_delete_retention_days
  purge_protection_enabled   = var.key_vault_purge_protection_enabled

  # Container Apps here run outside a VNet (same reason azurerm_mssql_firewall_rule.allow_azure_services
  # allows 0.0.0.0/0) — access control is RBAC + Managed Identity, not network isolation.
  # default_action must be "Allow": Container Apps is NOT on Key Vault's trusted-services
  # bypass list, so a "Deny" default blocks the backend's own data-plane calls (and any
  # operator running `az keyvault secret set` from outside Azure) regardless of RBAC grants.
  public_network_access_enabled = true

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  tags = local.tags
}

# The app CREATES secrets on certificate upload (SifenCertificateService.upload), so read-only
# "Key Vault Secrets User" is not enough — it needs "Secrets Officer".
resource "azurerm_role_assignment" "backend_kv_secrets_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = azurerm_container_app.backend.identity[0].principal_id
}

# So an operator can seed app-femme-jwt-secret post-apply (see infrastructure_v2.md) — its value
# must never enter Terraform state, so it's set out-of-band via `az keyvault secret set`.
resource "azurerm_role_assignment" "deployer_kv_secrets_officer" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.entra_sql_admin_object_id
}

resource "azurerm_monitor_diagnostic_setting" "key_vault" {
  name                       = "kv-diag"
  target_resource_id         = azurerm_key_vault.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "AuditEvent"
  }
}

# ---------------------------------------------------------------------------
# Service Bus — RT-20 (Hardening_SIFEN.md): asynchronous SIFEN transmission. The issue request
# never calls SIFEN synchronously; it signs the document and enqueues a transmit attempt here
# instead. Basic tier: queues + scheduled messages only — no topics, no sessions, no duplicate
# detection, no transactions. Deployed in BOTH environments (dev/testing also needs to process
# against SIFEN's TEST environment asynchronously, not just prod). Write-only in this PR: apply
# per environment when ready.
# ---------------------------------------------------------------------------

resource "azurerm_servicebus_namespace" "main" {
  name                = "${var.name_prefix}-sb-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Basic"
  # Managed Identity only — no SAS keys to leak (same posture as SQL's Entra-only auth).
  local_auth_enabled = false
  tags               = local.tags

  # Basic-tier constraints — Premium-only attributes that MUST NOT be set here:
  #   capacity, premium_messaging_partitions, zone_redundant, customer_managed_key, network_rule_set
}

resource "azurerm_servicebus_queue" "sifen_submission" {
  name         = "sifen-submission"
  namespace_id = azurerm_servicebus_namespace.main.id

  # Matches SifenSubmissionQueueListener.MAX_ATTEMPTS (initial attempt + 5 backoff retries).
  max_delivery_count = 6
  # Longer than the ~30s SIFEN timeout; Basic tier's maximum.
  lock_duration = "PT5M"
  # Basic tier's maximum (14 days) is not needed — the 72h signature transmission window is the
  # real bound on how long a message can usefully stay queued.
  default_message_ttl                  = "P7D"
  dead_lettering_on_message_expiration = true

  # Basic-tier constraints — setting any of these fails the apply:
  #   requires_session, requires_duplicate_detection, forward_to,
  #   forward_dead_lettered_messages_to, max_message_size_in_kilobytes (Premium only)
}

# Two narrow roles rather than one "Azure Service Bus Data Owner".
resource "azurerm_role_assignment" "backend_sb_sender" {
  scope                = azurerm_servicebus_queue.sifen_submission.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = azurerm_container_app.backend.identity[0].principal_id
}

resource "azurerm_role_assignment" "backend_sb_receiver" {
  scope                = azurerm_servicebus_queue.sifen_submission.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = azurerm_container_app.backend.identity[0].principal_id
}

# Same group granted Key Vault access via deployer_kv_secrets_officer above — lets developers run
# the backend locally against the real dev Service Bus queue instead of the in-process fallback.
resource "azurerm_role_assignment" "deployer_sb_sender" {
  scope                = azurerm_servicebus_queue.sifen_submission.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = var.entra_sql_admin_object_id
}

resource "azurerm_role_assignment" "deployer_sb_receiver" {
  scope                = azurerm_servicebus_queue.sifen_submission.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = var.entra_sql_admin_object_id
}

resource "azurerm_monitor_diagnostic_setting" "service_bus" {
  name                       = "sb-diag"
  target_resource_id         = azurerm_servicebus_namespace.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "OperationalLogs"
  }
}

# ---------------------------------------------------------------------------
# Container App Environment + Backend Container App
# ---------------------------------------------------------------------------

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.name_prefix}-cae-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  tags                       = local.tags

  depends_on = [azurerm_resource_provider_registration.app]
}

resource "azurerm_container_app" "backend" {
  name                         = "${var.name_prefix}-backend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  max_inactive_revisions       = 0
  tags                         = local.tags

  # System-assigned managed identity — used for passwordless SQL authentication.
  # After apply, grant this identity as a DB user (see infrastructure_v2.md post-apply steps).
  identity {
    type = "SystemAssigned"
  }

  # No SQL password secret — authentication is handled by the managed identity.
  secret {
    name  = "acs-connection-string"
    value = azurerm_communication_service.main.primary_connection_string
  }

  secret {
    name  = "appinsights-connection-string"
    value = azurerm_application_insights.main.connection_string
  }

  template {
    min_replicas = var.backend_min_replicas
    max_replicas = var.backend_max_replicas

    # Keeps the backend warm on a schedule (e.g. business hours) on top of
    # scale-to-zero, to avoid cold-start latency for the first users each day.
    # min_replicas stays 0 so the app still scales down outside the window.
    dynamic "custom_scale_rule" {
      for_each = var.backend_wake_schedule_enabled ? [1] : []
      content {
        name             = "wake-schedule"
        custom_rule_type = "cron"
        metadata = {
          timezone        = var.backend_wake_schedule_timezone
          start           = var.backend_wake_schedule_start
          end             = var.backend_wake_schedule_end
          desiredReplicas = tostring(var.backend_wake_schedule_replicas)
        }
      }
    }

    container {
      name   = "backend"
      image  = var.backend_container_image
      cpu    = 0.25
      memory = "0.5Gi"

      # Passwordless SQL via managed identity.
      # The MSSQL JDBC driver rejects any non-empty password when
      # Authentication=ActiveDirectoryMSI is set, so explicitly blank both vars
      # to override the local-dev defaults in application.properties.
      env {
        name  = "SPRING_DATASOURCE_URL"
        value = local.jdbc_url
      }

      env {
        name  = "SPRING_DATASOURCE_USERNAME"
        value = ""
      }

      env {
        name  = "SPRING_DATASOURCE_PASSWORD"
        value = ""
      }

      env {
        name  = "APP_FRONTEND_URL"
        value = local.frontend_allowed_origins
      }

      env {
        name        = "ACS_CONNECTION_STRING"
        secret_name = "acs-connection-string"
      }

      env {
        name  = "ACS_SENDER_ADDRESS"
        value = local.acs_sender_address
      }

      env {
        name        = "APPLICATIONINSIGHTS_CONNECTION_STRING"
        secret_name = "appinsights-connection-string"
      }

      env {
        name  = "FEMME_KEYVAULT_ENABLED"
        value = "true"
      }

      env {
        name  = "FEMME_KEYVAULT_URI"
        value = azurerm_key_vault.main.vault_uri
      }

      env {
        name  = "FEMME_SERVICEBUS_ENABLED"
        value = "true"
      }

      env {
        # ServiceBusClientBuilder.fullyQualifiedNamespace() wants the FQDN, not
        # azurerm_servicebus_namespace.main.endpoint (an https://…:443/ URL).
        name  = "FEMME_SERVICEBUS_NAMESPACE"
        value = "${azurerm_servicebus_namespace.main.name}.servicebus.windows.net"
      }

      env {
        name  = "FEMME_SERVICEBUS_QUEUE"
        value = azurerm_servicebus_queue.sifen_submission.name
      }

      # TCP probes (Azure's own default for ingress-enabled apps). HTTP probes on
      # /health were previously used here, but Container Apps counts HTTP probe
      # traffic as container activity, which prevented scale-to-zero — the backend
      # (and the SQL database behind it) stayed on indefinitely instead of pausing
      # when idle. /health itself doesn't check anything beyond "the app is up"
      # (see HealthController), so TCP loses no real signal. Kept in Terraform so
      # deploy only needs `az containerapp update --image` and does not re-specify
      # probes in CI.
      startup_probe {
        transport               = "TCP"
        port                    = var.backend_container_port
        initial_delay           = 10
        interval_seconds        = 5
        timeout                 = 5
        failure_count_threshold = 60
      }

      liveness_probe {
        transport               = "TCP"
        port                    = var.backend_container_port
        initial_delay           = 0
        interval_seconds        = 30
        timeout                 = 5
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "TCP"
        port                    = var.backend_container_port
        initial_delay           = 0
        interval_seconds        = 10
        timeout                 = 5
        failure_count_threshold = 3
        success_count_threshold = 1
      }
    }
  }

  ingress {
    external_enabled = true
    target_port      = var.backend_container_port
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  # CI deploys new images via `az containerapp update --image` between applies;
  # ignore drift here so `terraform apply` doesn't revert to backend_container_image.
  lifecycle {
    ignore_changes = [template[0].container[0].image]
  }
}

# ---------------------------------------------------------------------------
# Diagnostic settings
# ---------------------------------------------------------------------------

resource "azurerm_monitor_diagnostic_setting" "sql_server" {
  name                       = "sql-diag"
  target_resource_id         = "${azurerm_mssql_server.main.id}/databases/master"
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "SQLSecurityAuditEvents"
  }

  depends_on = [azurerm_mssql_server_extended_auditing_policy.main]
}

resource "azurerm_monitor_diagnostic_setting" "sql_database" {
  name                       = "db-diag"
  target_resource_id         = azurerm_mssql_database.app.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "SQLInsights"
  }

  enabled_log {
    category = "Errors"
  }

  enabled_metric {
    category = "Basic"
  }
}

resource "azurerm_monitor_diagnostic_setting" "acs" {
  name                       = "acs-diag"
  target_resource_id         = azurerm_communication_service.main.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id

  enabled_log {
    category = "ChatOperational"
  }

  enabled_log {
    category = "SMSOperational"
  }

  enabled_log {
    category = "AuthOperational"
  }
}
