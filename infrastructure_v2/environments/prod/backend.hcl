# Remote state for the prod environment (subscription 9e394b80…).
# Bootstrap this storage account before running terraform init:
#   bash scripts/bootstrap-terraform-remote-state.sh  (or create manually)
# Storage account names must be globally unique, 3–24 lowercase alphanumeric chars.
resource_group_name  = "rg-terraform-state-prod"
storage_account_name = "sttfstateprod359419b679"
container_name       = "tfstate"
