provider "azurerm" {
  features {
    resource_group {
      # App Insights auto-creates an action group outside Terraform state;
      # allow RG deletion without requiring all child resources to be managed.
      prevent_deletion_if_contains_resources = false
    }
  }
  # Required in azurerm 4.x when not using ARM_SUBSCRIPTION_ID.
  subscription_id = var.subscription_id
}

# Used to resolve Entra ID objects (SQL Entra admin group/user).
provider "azuread" {}
