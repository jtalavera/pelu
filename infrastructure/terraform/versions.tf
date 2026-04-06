terraform {
  required_version = ">= 1.5.0"

  # Remote state in Azure Storage. Supply resource group, account, and container via
  # backend.hcl (see backend.hcl.example) or: terraform init -backend-config=backend.hcl
  backend "azurerm" {
    key = "cursor-poc.tfstate"
  }

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}
