terraform {
  required_version = ">= 1.5.0"

  # Backend connection values (rg, storage account, container) come from the
  # per-environment backend.hcl file:
  #   terraform init -backend-config=environments/dev/backend.hcl
  backend "azurerm" {
    key = "infrastructure_v2.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    # Used to set properties not yet exposed by azurerm (e.g. SQL free-limit
    # grant on azurerm_mssql_database — see main.tf).
    azapi = {
      source  = "Azure/azapi"
      version = "~> 2.0"
    }
  }
}
