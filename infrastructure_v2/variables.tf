variable "subscription_id" {
  description = "Azure subscription ID where resources are deployed (maps to ARM_SUBSCRIPTION_ID)."
  type        = string
}

variable "environment" {
  description = "Environment name ('test' or 'prod'). Used in resource naming and tags."
  type        = string

  validation {
    condition     = contains(["test", "prod"], var.environment)
    error_message = "environment must be 'test' or 'prod'."
  }
}

variable "location" {
  description = "Azure region for Static Web Apps, Container Apps, Log Analytics, and resource group. Static Web Apps Free SKU is not available in all regions (e.g. eastus is unsupported); eastus2, centralus, westus2, and westeurope are typical options."
  type        = string
  default     = "eastus2"
}

variable "sql_server_location" {
  description = "Region for Azure SQL server and database only. Leave empty to match location. Some subscriptions return ProvisioningDisabled for SQL in certain regions — set this to a region where SQL creates successfully (try westeurope or centralus)."
  type        = string
  default     = ""
}

variable "name_prefix" {
  description = "Short prefix used in resource names (letters and numbers; keep lowercase)."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.name_prefix))
    error_message = "name_prefix must start with a letter and contain only lowercase letters, digits, and hyphens (2-21 chars)."
  }
}

variable "deployer_ip" {
  description = "Public IP of the operator machine to allow through the SQL Server firewall, in addition to the AllowAzureServices rule."
  type        = string
}

variable "entra_sql_admin_login" {
  description = "Display name of the Entra ID user or group to set as the SQL Server Entra administrator."
  type        = string
}

variable "entra_sql_admin_object_id" {
  description = "Object ID of the Entra ID user or group to set as the SQL Server Entra administrator."
  type        = string
}

variable "backend_container_image" {
  description = "Container image for the backend. Use GHCR, Docker Hub, or MCR (no Azure Container Registry in this stack)."
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "backend_container_port" {
  description = "Port the container listens on (Spring Boot default 8080)."
  type        = number
  default     = 8080
}

variable "backend_min_replicas" {
  description = "Minimum Container Apps replicas. 0 enables scale-to-zero, which eliminates idle compute cost (recommended; cold-start RTO is acceptable)."
  type        = number
  default     = 0

  validation {
    condition     = var.backend_min_replicas >= 0 && var.backend_min_replicas <= 3
    error_message = "backend_min_replicas must be between 0 and 3."
  }
}

variable "backend_max_replicas" {
  description = "Maximum Container Apps replicas."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_max_replicas >= 1 && var.backend_max_replicas <= 3
    error_message = "backend_max_replicas must be between 1 and 3."
  }
}

variable "backend_wake_schedule_enabled" {
  description = "Enable a KEDA cron scale rule that keeps the backend warm (1+ replicas) on a schedule, on top of the scale-to-zero min_replicas. Used to avoid cold-start latency during business hours."
  type        = bool
  default     = false
}

variable "backend_wake_schedule_timezone" {
  description = "IANA timezone for the wake schedule cron expressions (e.g. 'America/Asuncion')."
  type        = string
  default     = "America/Asuncion"
}

variable "backend_wake_schedule_start" {
  description = "Cron expression (KEDA cron scaler format) for when the backend should scale up to backend_wake_schedule_replicas. Default: 07:00, Monday-Saturday."
  type        = string
  default     = "0 7 * * 1-6"
}

variable "backend_wake_schedule_end" {
  description = "Cron expression (KEDA cron scaler format) for when the backend may resume scaling to zero. Default: 20:00, Monday-Saturday."
  type        = string
  default     = "0 20 * * 1-6"
}

variable "backend_wake_schedule_replicas" {
  description = "Desired replica count during the wake window."
  type        = number
  default     = 1

  validation {
    condition     = var.backend_wake_schedule_replicas >= 1
    error_message = "backend_wake_schedule_replicas must be at least 1."
  }
}

variable "sql_backup_storage_redundancy" {
  description = "Backup storage redundancy for the SQL database. 'Local' for test (cheapest); 'Zone' for prod (zone-resilient PITR backups, free-limit compatible)."
  type        = string
  default     = "Local"

  validation {
    condition     = contains(["Local", "Zone", "Geo"], var.sql_backup_storage_redundancy)
    error_message = "sql_backup_storage_redundancy must be 'Local', 'Zone', or 'Geo'."
  }
}

variable "log_analytics_daily_quota_gb" {
  description = "Daily ingestion cap for the Log Analytics workspace in GB. Prevents runaway cost. Set to -1 to disable the cap."
  type        = number
  default     = 0.5
}

variable "tags" {
  description = "Additional tags merged onto all supported resources. Environment and ManagedBy are always set automatically."
  type        = map(string)
  default     = {}
}

variable "frontend_custom_domains" {
  description = "Custom domains already registered on the Static Web App outside Terraform (e.g. [\"flowbit.tech\", \"www.flowbit.tech\"]), added as allowed CORS origins."
  type        = list(string)
  default     = []
}
