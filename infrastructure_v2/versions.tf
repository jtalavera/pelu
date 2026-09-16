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
      source = "hashicorp/azurerm"
      # >= 4.35 for azurerm_email_communication_service_domain_sender_username (custom email domain).
      version = "~> 4.35"
    }
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    azapi = {
      source = "Azure/azapi"
      # Only used to trigger ACS Email's initiateVerification action (no azurerm resource for it).
      version = "~> 2.0"
    }
  }
}
