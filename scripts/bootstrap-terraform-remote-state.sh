#!/usr/bin/env bash
# Creates Azure Storage (resource group, storage account, tfstate container) for Terraform
# remote state, writes infrastructure/terraform/backend.hcl, and runs terraform init.
#
# Prerequisites: Azure CLI (az), logged in; optional: Terraform on PATH for init.
#
# Usage:
#   ./scripts/bootstrap-terraform-remote-state.sh
#   ./scripts/bootstrap-terraform-remote-state.sh -s <subscription-id> --storage-account sttfstatemyname
#   ./scripts/bootstrap-terraform-remote-state.sh --migrate-state   # if local terraform.tfstate exists
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/infrastructure/terraform"
BACKEND_HCL="${TERRAFORM_DIR}/backend.hcl"
TFVARS="${TERRAFORM_DIR}/terraform.tfvars"

SUBSCRIPTION_ID="${ARM_SUBSCRIPTION_ID:-}"
LOCATION="eastus2"
RESOURCE_GROUP="rg-terraform-state"
STORAGE_ACCOUNT=""
CONTAINER_NAME="tfstate"
RUN_INIT=true
MIGRATE_STATE=false
RECONFIGURE=false

usage() {
  cat <<EOF
Bootstrap Azure Storage for Terraform remote state and write infrastructure/terraform/backend.hcl.

Prerequisites: Azure CLI (az), logged in; optional: Terraform for init.

Usage: ${0##*/} [options]

Options:
  -s, --subscription ID     Azure subscription (default: ARM_SUBSCRIPTION_ID or subscription_id in terraform.tfvars)
  -l, --location REGION     Azure region (default: ${LOCATION})
  -g, --resource-group NAME Resource group for state storage (default: ${RESOURCE_GROUP})
  -a, --storage-account NAME Storage account name: 3-24 chars, lowercase letters and numbers, globally unique.
                            If omitted, a name like sttfstate<random> is generated.
  -c, --container NAME      Blob container name (default: ${CONTAINER_NAME})
      --no-init             Only create Azure resources and write backend.hcl; do not run terraform init
      --migrate-state         Pass to terraform init when local state exists (upload local state to blob)
      --reconfigure           Pass -reconfigure to terraform init (switch backend without migration)
  -h, --help                Show this help

Examples:
  ${0##*/}
  ${0##*/} -a sttfstatecursorpoc01
  ${0##*/} --migrate-state
EOF
}

log() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

parse_subscription_from_tfvars() {
  if [[ -f "${TFVARS}" ]]; then
    # subscription_id = "uuid"
    grep -E '^[[:space:]]*subscription_id[[:space:]]*=' "${TFVARS}" | head -1 | sed -E 's/^[[:space:]]*subscription_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/'
  fi
}

generate_storage_account_name() {
  local suffix
  suffix="$(openssl rand -hex 4)"
  echo "sttfstate${suffix}"
}

storage_name_available() {
  local name="$1"
  az storage account check-name --name "$name" --query nameAvailable -o tsv 2>/dev/null | grep -qi true
}

ensure_unique_storage_name() {
  local name try=0
  while [[ $try -lt 10 ]]; do
    name="$(generate_storage_account_name)"
    if storage_name_available "$name"; then
      echo "$name"
      return 0
    fi
    try=$((try + 1))
  done
  die "Could not generate an available storage account name after ${try} attempts; pass --storage-account explicitly."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--subscription)
      SUBSCRIPTION_ID="${2:-}"; shift 2 ;;
    -l|--location)
      LOCATION="${2:-}"; shift 2 ;;
    -g|--resource-group)
      RESOURCE_GROUP="${2:-}"; shift 2 ;;
    -a|--storage-account)
      STORAGE_ACCOUNT="${2:-}"; shift 2 ;;
    -c|--container)
      CONTAINER_NAME="${2:-}"; shift 2 ;;
    --no-init)
      RUN_INIT=false; shift ;;
    --migrate-state)
      MIGRATE_STATE=true; shift ;;
    --reconfigure)
      RECONFIGURE=true; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "Unknown option: $1 (use --help)" ;;
  esac
done

if [[ -z "${SUBSCRIPTION_ID}" ]]; then
  SUBSCRIPTION_ID="$(parse_subscription_from_tfvars || true)"
fi
[[ -n "${SUBSCRIPTION_ID}" ]] || die "Set subscription via -s, ARM_SUBSCRIPTION_ID, or subscription_id in ${TFVARS}"

command -v az >/dev/null || die "Azure CLI (az) not found."

if ! az account show &>/dev/null; then
  die "Not logged in to Azure. Run: az login"
fi

log "Setting subscription to ${SUBSCRIPTION_ID}"
az account set --subscription "${SUBSCRIPTION_ID}"

log "Creating resource group ${RESOURCE_GROUP} in ${LOCATION}"
az group create --name "${RESOURCE_GROUP}" --location "${LOCATION}" --output none

if [[ -z "${STORAGE_ACCOUNT}" ]]; then
  STORAGE_ACCOUNT="$(ensure_unique_storage_name)"
  log "Using generated storage account name: ${STORAGE_ACCOUNT}"
else
  if [[ ! "${STORAGE_ACCOUNT}" =~ ^[a-z0-9]{3,24}$ ]]; then
    die "Storage account name must be 3-24 lowercase letters and numbers only."
  fi
  if ! storage_name_available "${STORAGE_ACCOUNT}"; then
    die "Storage account name '${STORAGE_ACCOUNT}' is not available globally. Choose another --storage-account."
  fi
fi

log "Creating storage account ${STORAGE_ACCOUNT}"
az storage account create \
  --name "${STORAGE_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --location "${LOCATION}" \
  --sku Standard_LRS \
  --encryption-services blob \
  --output none

log "Creating container ${CONTAINER_NAME}"
az storage container create \
  --name "${CONTAINER_NAME}" \
  --account-name "${STORAGE_ACCOUNT}" \
  --auth-mode login \
  --output none

log "Writing ${BACKEND_HCL}"
cat > "${BACKEND_HCL}" <<EOF
# Generated by scripts/bootstrap-terraform-remote-state.sh — edit only if you change the storage account.
resource_group_name  = "${RESOURCE_GROUP}"
storage_account_name = "${STORAGE_ACCOUNT}"
container_name       = "${CONTAINER_NAME}"
EOF

if [[ "${RUN_INIT}" != "true" ]]; then
  log "Skipping terraform init (--no-init). Next: cd ${TERRAFORM_DIR} && terraform init -backend-config=backend.hcl"
  exit 0
fi

command -v terraform >/dev/null || {
  log "Terraform not on PATH; backend.hcl is ready. Install Terraform, then:"
  log "  cd ${TERRAFORM_DIR} && terraform init -backend-config=backend.hcl"
  exit 0
}

INIT_ARGS=(init -backend-config=backend.hcl)
if [[ "${MIGRATE_STATE}" == "true" ]]; then
  INIT_ARGS+=(-migrate-state)
fi
if [[ "${RECONFIGURE}" == "true" ]]; then
  INIT_ARGS+=(-reconfigure)
fi

if [[ -f "${TERRAFORM_DIR}/terraform.tfstate" ]] && [[ "${MIGRATE_STATE}" != "true" ]]; then
  log "Note: ${TERRAFORM_DIR}/terraform.tfstate exists. To copy it to Azure Storage, re-run with --migrate-state"
fi

log "Running: terraform ${INIT_ARGS[*]}"
(
  cd "${TERRAFORM_DIR}"
  terraform "${INIT_ARGS[@]}"
)

log "Done. Remote state key is defined in versions.tf (blob name). Run terraform plan from ${TERRAFORM_DIR}."
