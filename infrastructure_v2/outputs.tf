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
  description = "Frontend origin used in CORS (APP_FRONTEND_URL env var on the Container App)."
  value       = local.frontend_origin
}

output "acs_sender_address" {
  description = "Email sender address from the Azure Communication Services managed domain."
  value       = local.acs_sender_address
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
