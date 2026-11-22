provider "azurerm" {
  features {
    resource_group {
      # App Insights auto-creates an action group outside Terraform state;
      # allow RG deletion without requiring all child resources to be managed.
      prevent_deletion_if_contains_resources = false
    }
    cognitive_account {
      # The Foundry account (assistant) is soft-deleted on destroy and its custom subdomain stays
      # reserved for 48 h, which would break the next staging `up.sh` (same name, new RG).
      purge_soft_delete_on_destroy = true
    }
  }
  # Required in azurerm 4.x when not using ARM_SUBSCRIPTION_ID.
  subscription_id = var.subscription_id
}

# Used to resolve Entra ID objects (SQL Entra admin group/user).
provider "azuread" {}

# Only used for the ACS Email custom-domain verification action (no azurerm resource for it yet).
provider "azapi" {
  subscription_id = var.subscription_id
}
