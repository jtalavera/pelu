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
  }
}
