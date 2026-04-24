output "resource_group_name" {
  description = "Resource group containing the test environment."
  value       = azurerm_resource_group.main.name
}

output "static_web_app_default_host_name" {
  description = "Public hostname of the Static Web App (frontend). Deploy site files with SWA CLI or GitHub Actions."
  value       = azurerm_static_web_app.frontend.default_host_name
}

output "static_web_app_api_key" {
  description = "Deployment API key for Azure Static Web Apps (sensitive)."
  value       = azurerm_static_web_app.frontend.api_key
  sensitive   = true
}

output "container_app_fqdn" {
  description = "Stable app-level FQDN of the backend Container App (does not change across revisions)."
  value       = azurerm_container_app.backend.ingress[0].fqdn
}

output "sql_server_location" {
  description = "Azure region of the SQL server (may differ from location if sql_server_location is set)."
  value       = local.sql_location
}

output "sql_server_fqdn" {
  description = "Azure SQL server FQDN."
  value       = azurerm_mssql_server.main.fully_qualified_domain_name
}

output "sql_database_name" {
  description = "Azure SQL database name (Free SKU)."
  value       = azurerm_mssql_database.app.name
}

output "sql_admin_login" {
  description = "SQL authentication login for the server."
  value       = var.sql_admin_login
}

output "sql_admin_password" {
  description = "SQL authentication password (sensitive). Prefer rotating after bootstrap."
  value       = random_password.sql_admin.result
  sensitive   = true
}

output "jdbc_url" {
  description = "JDBC URL for Spring-style configuration (password supplied separately)."
  value       = local.jdbc_url
}

output "frontend_origin_for_cors" {
  description = "HTTPS origin to allow in backend CORS and OAuth redirect configuration."
  value       = local.frontend_origin
}

output "acs_sender_address" {
  description = "From address for transactional emails (ACS Azure-managed domain)."
  value       = "DoNotReply@${azurerm_email_communication_service_domain.main.from_sender_domain}"
}

output "log_analytics_workspace_id" {
  description = "Resource ID of the central Log Analytics Workspace."
  value       = azurerm_log_analytics_workspace.main.id
}

output "application_insights_connection_string" {
  description = "Application Insights connection string for the backend (sensitive)."
  value       = azurerm_application_insights.main.connection_string
  sensitive   = true
}

output "application_insights_app_id" {
  description = "Application Insights application ID (for Kusto queries and dashboards)."
  value       = azurerm_application_insights.main.app_id
}
