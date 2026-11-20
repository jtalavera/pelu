# Remote state for the disposable staging environment (docs/staging-env.md).
# Same storage account as dev (subscription 677a6eab…), separate key — overrides the
# `key` in versions.tf. Always init with -reconfigure when switching from dev/prod:
#   terraform init -reconfigure -backend-config=environments/staging/backend.hcl
resource_group_name  = "rg-terraform-state-dev"
storage_account_name = "sttfstatedev3tfruqf0"
container_name       = "tfstate"
key                  = "staging.tfstate"
