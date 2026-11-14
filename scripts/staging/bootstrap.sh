#!/usr/bin/env bash
# One-time (idempotent) setup for staging (docs/staging-env.md, T4 + persistent data storage).
# Nothing here is disposable: run it once, re-run safely after changes.
#
#   scripts/staging/bootstrap.sh
#
# Optional environment:
#   GHCR_USERNAME / GHCR_READ_PACKAGES_PAT   copied into v2-staging if the GHCR image is private
#
# Creates:
#   1. GitHub Environment v2-staging, with the repo owner as required reviewer, and its
#      AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_SUBSCRIPTION_ID secrets (same app as v2-test).
#   2. Federated credential repo:<repo>:environment:v2-staging on the femme-cicd-v2-test app.
#      Contributor on femme-staging-rg is granted by Terraform on every apply
#      (ci_deployer_principal_id), so no role is assigned here.
#   3. femme-staging-data-rg / STAGING_DATA_ACCOUNT: private (no public blob access, no shared-key
#      auth), containers snapshots/ loadtest/ loadtest-reports/ state/, lifecycle rule deleting
#      snapshots/ after SNAPSHOT_RETENTION_DAYS, RBAC: femme-sql-admins = Blob Data Contributor on
#      the account; the CI app = Blob Data Contributor on loadtest-reports/ only.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd az gh jq
ensure_subscription "$STAGING_SUBSCRIPTION_ID"
TENANT_ID="$(az account show --query tenantId -o tsv)"

# ---------------------------------------------------------------------------------------------
log "1/3 GitHub Environment $GH_ENVIRONMENT"
OWNER_ID="$(gh api "repos/$GH_REPO" --jq .owner.id)"
jq -n --argjson id "$OWNER_ID" '{reviewers: [{type: "User", id: $id}], prevent_self_review: false,
  deployment_branch_policy: null}' \
  | gh api -X PUT "repos/$GH_REPO/environments/$GH_ENVIRONMENT" --input - >/dev/null
gh_env_secret() { printf '%s' "$2" | gh secret set "$1" -R "$GH_REPO" --env "$GH_ENVIRONMENT" >/dev/null; }
gh_env_secret AZURE_CLIENT_ID "$CI_APP_CLIENT_ID"
gh_env_secret AZURE_TENANT_ID "$TENANT_ID"
gh_env_secret AZURE_SUBSCRIPTION_ID "$STAGING_SUBSCRIPTION_ID"
if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_READ_PACKAGES_PAT:-}" ]]; then
  gh_env_secret GHCR_USERNAME "$GHCR_USERNAME"
  gh_env_secret GHCR_READ_PACKAGES_PAT "$GHCR_READ_PACKAGES_PAT"
fi

# ---------------------------------------------------------------------------------------------
log "2/3 federated credential environment:$GH_ENVIRONMENT on app $CI_APP_CLIENT_ID"
SUBJECT="repo:$GH_REPO:environment:$GH_ENVIRONMENT"
if az ad app federated-credential list --id "$CI_APP_CLIENT_ID" --query "[?subject=='$SUBJECT'] | length(@)" -o tsv | grep -q '^0$'; then
  FC_FILE="$(mktemp)"
  jq -n --arg s "$SUBJECT" '{name: "github-v2-staging", issuer: "https://token.actions.githubusercontent.com",
    subject: $s, audiences: ["api://AzureADTokenExchange"], description: "deploy-v2.yml / loadtest.yml → v2-staging"}' \
    >"$FC_FILE"
  az ad app federated-credential create --id "$CI_APP_CLIENT_ID" --parameters @"$FC_FILE" -o none
  rm -f "$FC_FILE"
else
  log "already present"
fi
CI_SP_OBJECT_ID="$(az ad sp show --id "$CI_APP_CLIENT_ID" --query id -o tsv)"
grep -q "ci_deployer_principal_id = \"$CI_SP_OBJECT_ID\"" "$STAGING_TFVARS" \
  || warn "set ci_deployer_principal_id = \"$CI_SP_OBJECT_ID\" in $STAGING_TFVARS"

# ---------------------------------------------------------------------------------------------
log "3/3 persistent storage $STAGING_DATA_RG/$STAGING_DATA_ACCOUNT"
az group create -n "$STAGING_DATA_RG" -l "$STAGING_DATA_LOCATION" --tags Purpose=staging-data ManagedBy=scripts/staging/bootstrap.sh -o none
if ! az storage account show -n "$STAGING_DATA_ACCOUNT" -g "$STAGING_DATA_RG" -o none 2>/dev/null; then
  [[ "$(az storage account check-name -n "$STAGING_DATA_ACCOUNT" --query nameAvailable -o tsv)" == "true" ]] \
    || die "storage account name $STAGING_DATA_ACCOUNT is taken — change STAGING_DATA_ACCOUNT in scripts/staging/staging.env"
  az storage account create -n "$STAGING_DATA_ACCOUNT" -g "$STAGING_DATA_RG" -l "$STAGING_DATA_LOCATION" \
    --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --https-only true \
    --allow-blob-public-access false --allow-shared-key-access false -o none
fi
ACCOUNT_ID="$(az storage account show -n "$STAGING_DATA_ACCOUNT" -g "$STAGING_DATA_RG" --query id -o tsv)"

ensure_role() { # ensure_role <principal object id> <principal type> <role> <scope>
  if [[ "$(az role assignment list --assignee "$1" --role "$3" --scope "$4" --query 'length(@)' -o tsv)" == "0" ]]; then
    az role assignment create --assignee-object-id "$1" --assignee-principal-type "$2" --role "$3" --scope "$4" -o none
  fi
}
ensure_role "$SQL_ADMINS_GROUP_OBJECT_ID" Group "Storage Blob Data Contributor" "$ACCOUNT_ID"
log "waiting for the data-plane role to propagate"
for c in "$SNAPSHOT_CONTAINER" "$LOADTEST_CONTAINER" "$REPORTS_CONTAINER" "$STATE_CONTAINER"; do
  retry 12 20 az storage container create --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" -n "$c" \
    --public-access off -o none || die "cannot create container $c"
done
ensure_role "$CI_SP_OBJECT_ID" ServicePrincipal "Storage Blob Data Contributor" \
  "$ACCOUNT_ID/blobServices/default/containers/$REPORTS_CONTAINER"

POLICY="$(jq -n --arg p "$SNAPSHOT_CONTAINER/prod-" --argjson d "$SNAPSHOT_RETENTION_DAYS" '{rules: [{
  enabled: true, name: "expire-prod-snapshots", type: "Lifecycle",
  definition: {filters: {blobTypes: ["blockBlob"], prefixMatch: [$p]},
    actions: {baseBlob: {delete: {daysAfterCreationGreaterThan: $d}}}}}]}')"
az storage account management-policy create --account-name "$STAGING_DATA_ACCOUNT" -g "$STAGING_DATA_RG" \
  --policy "$POLICY" -o none

log "bootstrap complete"
echo "  GitHub Environment: https://github.com/$GH_REPO/settings/environments"
echo "  Storage:            $STAGING_DATA_RG/$STAGING_DATA_ACCOUNT"
