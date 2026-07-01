resource "random_string" "suffix" {
  length  = 6
  lower   = true
  special = false
  upper   = false
}

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

  frontend_origin    = "https://${azurerm_static_web_app.frontend.default_host_name}"
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

  # Serverless General Purpose, Gen5, 1 vCore max / 0.5 vCore min.
  # Auto-pauses after 60 min of inactivity to minimise cost.
  sku_name                    = "GP_S_Gen5_1"
  min_capacity                = 0.5
  auto_pause_delay_in_minutes = 60

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

    container {
      name   = "backend"
      image  = var.backend_container_image
      cpu    = 0.25
      memory = "0.5Gi"

      # Passwordless SQL: no username/password env vars.
      # The JDBC driver acquires a token from the managed identity endpoint.
      env {
        name  = "SPRING_DATASOURCE_URL"
        value = local.jdbc_url
      }

      env {
        name  = "APP_FRONTEND_URL"
        value = local.frontend_origin
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

      # HTTP probes on /health (public in SecurityConfig). Kept in Terraform so deploy
      # only needs `az containerapp update --image` and does not re-specify probes in CI.
      startup_probe {
        transport               = "HTTP"
        path                    = "/health"
        port                    = var.backend_container_port
        initial_delay           = 10
        interval_seconds        = 5
        timeout                 = 5
        failure_count_threshold = 60
      }

      liveness_probe {
        transport               = "HTTP"
        path                    = "/health"
        port                    = var.backend_container_port
        initial_delay           = 0
        interval_seconds        = 30
        timeout                 = 5
        failure_count_threshold = 3
      }

      readiness_probe {
        transport               = "HTTP"
        path                    = "/health"
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
