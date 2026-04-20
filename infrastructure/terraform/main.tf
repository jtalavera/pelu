resource "random_string" "suffix" {
  length  = 6
  lower   = true
  special = false
  upper   = false
}

resource "random_password" "sql_admin" {
  length           = 24
  special          = true
  override_special = "!#()-_=+[]"
}

# Required for Container Apps (Microsoft.App). One-time per subscription; Terraform waits until registered.
resource "azurerm_resource_provider_registration" "app" {
  name = "Microsoft.App"
}

resource "azurerm_resource_group" "main" {
  name     = "${var.name_prefix}-rg-test"
  location = var.location
  tags     = var.tags
}

resource "azurerm_log_analytics_workspace" "aca" {
  name                = "${var.name_prefix}-aca-logs-${random_string.suffix.result}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = var.tags
}

resource "azurerm_container_app_environment" "main" {
  name                       = "${var.name_prefix}-cae-${random_string.suffix.result}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.aca.id
  tags                       = var.tags

  depends_on = [azurerm_resource_provider_registration.app]
}

resource "azurerm_static_web_app" "frontend" {
  name                = "${var.name_prefix}-swa-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = var.tags
}

locals {
  # SQL can be deployed in a different region if the subscription blocks Azure SQL in `location` (ProvisioningDisabled).
  sql_location = trimspace(var.sql_server_location) != "" ? var.sql_server_location : var.location
}

resource "azurerm_mssql_server" "main" {
  name                          = "${var.name_prefix}sql${random_string.suffix.result}"
  resource_group_name           = azurerm_resource_group.main.name
  location                      = local.sql_location
  version                       = "12.0"
  administrator_login           = var.sql_admin_login
  administrator_login_password  = random_password.sql_admin.result
  minimum_tls_version           = "1.2"
  public_network_access_enabled = true
  tags                          = var.tags
}

# Azure Communication Services — Email
resource "azurerm_resource_provider_registration" "communication" {
  name = "Microsoft.Communication"
}

resource "azurerm_email_communication_service" "main" {
  name                = "${var.name_prefix}-email-${random_string.suffix.result}"
  resource_group_name = azurerm_resource_group.main.name
  data_location       = "United States"
  tags                = var.tags

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
  tags                = var.tags

  depends_on = [azurerm_resource_provider_registration.communication]
}

resource "azurerm_communication_service_email_domain_association" "main" {
  communication_service_id = azurerm_communication_service.main.id
  email_service_domain_id  = azurerm_email_communication_service_domain.main.id
}

resource "azurerm_mssql_firewall_rule" "allow_azure_services" {
  name             = "AllowAzureServices"
  server_id        = azurerm_mssql_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_mssql_database" "app" {
  name      = "${var.name_prefix}_app_db"
  server_id = azurerm_mssql_server.main.id
  sku_name  = "Free"
  collation = "SQL_Latin1_General_CP1_CI_AS"
  # Do not set max_size_gb: explicit sizes (e.g. 2 or 32) return InvalidMaxSizeTierCombination for sku Free.
  # The portal "free offer" (serverless + useFreeLimit + larger cap) is not fully modeled here; omitting lets Azure set a valid default.
  tags = var.tags
}

locals {
  sql_fqdn = azurerm_mssql_server.main.fully_qualified_domain_name
  sql_db   = azurerm_mssql_database.app.name
  jdbc_url = format(
    "jdbc:sqlserver://%s:1433;databaseName=%s;encrypt=true;trustServerCertificate=false;hostNameInCertificate=*.database.windows.net;loginTimeout=30",
    local.sql_fqdn,
    local.sql_db
  )
  frontend_origin = "https://${azurerm_static_web_app.frontend.default_host_name}"
}

resource "azurerm_container_app" "backend" {
  name                         = "${var.name_prefix}-backend"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  tags                         = var.tags

  secret {
    name  = "sql-password"
    value = random_password.sql_admin.result
  }

  secret {
    name  = "acs-connection-string"
    value = azurerm_communication_service.main.primary_connection_string
  }

  template {
    min_replicas = var.backend_min_replicas
    max_replicas = var.backend_max_replicas

    container {
      name   = "backend"
      image  = var.backend_container_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "SPRING_DATASOURCE_URL"
        value = local.jdbc_url
      }

      env {
        name  = "SPRING_DATASOURCE_USERNAME"
        value = var.sql_admin_login
      }

      env {
        name        = "SPRING_DATASOURCE_PASSWORD"
        secret_name = "sql-password"
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
        value = "DoNotReply@${azurerm_email_communication_service_domain.main.from_sender_domain}"
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
