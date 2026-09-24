output "resource_group_name" {
  description = "Name of the resource group."
  value       = azurerm_resource_group.main.name
}

output "static_web_app_default_host_name" {
  description = "Default hostname of the Static Web App (frontend)."
  value       = azurerm_static_web_app.frontend.default_host_name
}

output "static_web_app_api_key" {
  description = "Deployment token for the Static Web App. Pass as SWA_CLI_DEPLOYMENT_TOKEN in CI."
  value       = azurerm_static_web_app.frontend.api_key
  sensitive   = true
}

output "container_app_fqdn" {
  description = "Public FQDN of the backend Container App (e.g. https://<name>.<region>.azurecontainerapps.io)."
  value       = "https://${azurerm_container_app.backend.ingress[0].fqdn}"
}

output "container_app_principal_id" {
  description = "Principal ID of the Container App's system-assigned managed identity. Use this to grant the identity access as a SQL database user (see post-apply steps in infrastructure_v2.md)."
  value       = azurerm_container_app.backend.identity[0].principal_id
}

output "sql_server_location" {
  description = "Azure region where the SQL Server was deployed."
  value       = azurerm_mssql_server.main.location
}

output "sql_server_fqdn" {
  description = "Fully qualified domain name of the Azure SQL Server."
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "sql_database_name" {
  description = "Name of the SQL database."
  value       = azurerm_mssql_database.app.name
}

output "jdbc_url" {
  description = "JDBC connection string using managed-identity (ActiveDirectoryMSI) authentication. No username or password required."
  value       = local.jdbc_url
}

output "frontend_origin_for_cors" {
  description = "Comma-separated frontend origins used in CORS (APP_FRONTEND_URL env var on the Container App)."
  value       = local.frontend_allowed_origins
}

output "acs_sender_address_reminders" {
  description = "Sender address for appointment-reminder emails."
  value       = local.acs_sender_address_reminders
}

output "acs_sender_address_invoices" {
  description = "Sender address for SIFEN invoice/KuDE emails."
  value       = local.acs_sender_address_invoices
}

output "acs_sender_address_generic" {
  description = "Sender address for every other email (account activation, password reset)."
  value       = local.acs_sender_address_generic
}

output "email_domain_verification_records" {
  description = "DNS records to add at var.email_custom_domain's DNS provider before setting email_domain_verification_enabled=true. Null until email_custom_domain is set."
  value       = local.email_domain_ready ? azurerm_email_communication_service_domain.custom[0].verification_records : null
}

output "log_analytics_workspace_id" {
  description = "Resource ID of the Log Analytics workspace."
  value       = azurerm_log_analytics_workspace.main.id
}

output "application_insights_connection_string" {
  description = "Application Insights connection string. Set as APPLICATIONINSIGHTS_CONNECTION_STRING on the backend."
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "application_insights_app_id" {
  description = "Application Insights application ID."
  value       = azurerm_application_insights.main.app_id
}

output "key_vault_uri" {
  description = "Vault URI for the Key Vault holding SIFEN certificate secrets and the JWT secret (RT-12/RT-18). Use with `az keyvault secret set --vault-name <name-from-key_vault_name-output> --name app-femme-jwt-secret --value ...` post-apply."
  value       = azurerm_key_vault.main.vault_uri
}

output "key_vault_name" {
  description = "Name of the Key Vault (for az keyvault CLI commands)."
  value       = azurerm_key_vault.main.name
}

output "service_bus_namespace" {
  description = "Fully qualified Service Bus namespace (RT-20) — matches FEMME_SERVICEBUS_NAMESPACE on the backend."
  value       = "${azurerm_servicebus_namespace.main.name}.servicebus.windows.net"
}

output "service_bus_queue_name" {
  description = "Name of the SIFEN submission queue (for az servicebus CLI commands, e.g. checking the dead-letter queue depth)."
  value       = azurerm_servicebus_queue.sifen_submission.name
}

output "app_insights_connection_string" {
  description = "Issue #268: App Insights connection string — set as the VITE_APPINSIGHTS_CONNECTION_STRING GitHub Environment variable for the frontend build (browser RUM). An ingestion endpoint, not a credential, but azurerm marks it sensitive."
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "workbook_ids" {
  description = "Issue #268: resource IDs of the infra and business Application Insights workbooks."
  value = {
    infra    = azurerm_application_insights_workbook.infra.id
    business = azurerm_application_insights_workbook.business.id
  }
}
