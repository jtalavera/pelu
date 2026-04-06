variable "subscription_id" {
  description = "Azure subscription ID where resources are deployed (maps to ARM_SUBSCRIPTION_ID)."
  type        = string
}

variable "location" {
  description = "Azure region for Static Web Apps, Container Apps, Log Analytics, and resource group. Static Web Apps Free SKU is not available in all regions (e.g. eastus is unsupported); eastus2, centralus, westus2, and westeurope are typical options."
  type        = string
  default     = "eastus2"
}

variable "sql_server_location" {
  description = "Region for Azure SQL server and database only. Leave empty to match location. Some subscriptions return ProvisioningDisabled for SQL in certain regions—in that case set this to a region where SQL creates successfully (try westeurope or centralus). Cross-region latency applies between Container Apps and SQL."
  type        = string
  default     = ""
}

variable "name_prefix" {
  description = "Short prefix used in resource names (letters and numbers; keep lowercase)."
  type        = string
  default     = "cursortest"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name_prefix))
    error_message = "name_prefix must start with a letter and contain only lowercase letters, digits, and hyphens (2-21 chars)."
  }
}

variable "sql_admin_login" {
  description = "Administrator login for Azure SQL Server (SQL authentication)."
  type        = string
  default     = "sqladmin"
}

variable "backend_container_image" {
  description = "Public container image for the backend (no Azure Container Registry in this stack—use GHCR, Docker Hub, or MCR)."
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "backend_container_port" {
  description = "Port the container listens on (Spring Boot default 8080)."
  type        = number
  default     = 8080
}

variable "backend_min_replicas" {
  description = "Minimum Container Apps replicas (0 allows scale-to-zero to conserve free grant)."
  type        = number
  default     = 0

  validation {
    condition     = var.backend_min_replicas >= 0 && var.backend_min_replicas <= 3
    error_message = "backend_min_replicas must be between 0 and 3 for this template."
  }
}

variable "backend_max_replicas" {
  description = "Maximum Container Apps replicas for the test environment."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_max_replicas >= 1 && var.backend_max_replicas <= 3
    error_message = "backend_max_replicas must be between 1 and 3 for this template."
  }
}

variable "tags" {
  description = "Common tags applied to supported resources."
  type        = map(string)
  default = {
    Environment = "test"
    ManagedBy   = "terraform"
  }
}
