provider "azurerm" {
  features {}
  # Required in azurerm 4.x when not using ARM_SUBSCRIPTION_ID.
  subscription_id = var.subscription_id
}

# Used to resolve Entra ID objects (SQL Entra admin group/user).
provider "azuread" {}
