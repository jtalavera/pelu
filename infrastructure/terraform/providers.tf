provider "azurerm" {
  features {}

  # Required in azurerm 4.x when not using ARM_SUBSCRIPTION_ID.
  subscription_id = var.subscription_id
}
