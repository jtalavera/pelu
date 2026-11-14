#!/usr/bin/env bash
# Tear down the staging environment (docs/staging-env.md, T3).
#
#   scripts/staging/down.sh [--yes]        terraform destroy → purge vault → clear v2-staging
#                                           secrets → confirm the RG is gone
#   scripts/staging/down.sh --fallback     destroy got stuck: az group delete femme-staging-rg,
#                                           delete the staging.tfstate blob, purge, clear secrets
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FALLBACK=0
for arg in "$@"; do
  case "$arg" in
    --yes) export ASSUME_YES=1 ;;
    --fallback) FALLBACK=1 ;;
    -h | --help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done

require_cmd az terraform gh jq
ensure_subscription "$STAGING_SUBSCRIPTION_ID"

# Vault name: from state if possible, else whatever femme-kv-* lives in the staging RG.
KV_NAME=""
if [[ "$(az group exists -n "$STAGING_RG")" == "true" ]]; then
  KV_NAME="$(az keyvault list -g "$STAGING_RG" --query '[0].name' -o tsv 2>/dev/null || true)"
fi

confirm "Destroy EVERYTHING in $STAGING_RG (subscription $STAGING_SUBSCRIPTION_ID)?"

if ((FALLBACK)); then
  warn "fallback: deleting the resource group directly and discarding staging.tfstate"
  if [[ "$(az group exists -n "$STAGING_RG")" == "true" ]]; then
    az group delete -n "$STAGING_RG" --yes
  fi
  az storage blob delete --auth-mode login --account-name sttfstatedev3tfruqf0 -c tfstate \
    -n staging.tfstate --subscription "$STAGING_SUBSCRIPTION_ID" --only-show-errors || true
else
  tf_staging_init
  [[ -z "$KV_NAME" ]] && KV_NAME="$(tf_out key_vault_name 2>/dev/null || true)"
  log "terraform destroy"
  DESTROY_ARGS=(-input=false -var-file="environments/staging/terraform.tfvars")
  [[ "${ASSUME_YES:-0}" == "1" ]] && DESTROY_ARGS+=(-auto-approve)
  terraform -chdir="$INFRA_DIR" destroy "${DESTROY_ARGS[@]}" \
    || die "terraform destroy failed — retry, or run: scripts/staging/down.sh --fallback"
fi

# Soft-deleted vault: purge it so the name and its secrets are really gone (no purge protection
# in staging). azurerm's default (purge_soft_delete_on_destroy) usually purges it during destroy
# already — that is why destroy takes ~30 min — so this is the fallback, e.g. after --fallback.
# The vault may take a moment to appear in the deleted list.
if [[ -n "$KV_NAME" ]]; then
  if [[ -z "$(az keyvault list-deleted --query "[?name=='$KV_NAME'].name" -o tsv)" ]]; then
    log "vault $KV_NAME is not in the soft-deleted list (already purged by terraform destroy)"
  fi
  for _ in $(seq 1 12); do
    if [[ "$(az keyvault list-deleted --query "[?name=='$KV_NAME'] | length(@)" -o tsv)" == "1" ]]; then
      log "purging soft-deleted vault $KV_NAME"
      az keyvault purge --name "$KV_NAME" --only-show-errors
      break
    fi
    [[ -z "$(az keyvault list-deleted --query "[?name=='$KV_NAME'].name" -o tsv)" ]] && ((FALLBACK == 0)) && break
    sleep 10
  done
fi

log "clearing v2-staging secrets that point at dead resources"
for s in AZURE_STATIC_WEB_APPS_API_TOKEN VITE_API_BASE_URL AZURE_RESOURCE_GROUP_NAME AZURE_CONTAINER_APP_NAME LOADTEST_BASE_URL LOADTEST_USERS_JSON; do
  gh secret delete "$s" -R "$GH_REPO" --env "$GH_ENVIRONMENT" >/dev/null 2>&1 || true
done
gh variable delete VITE_APPINSIGHTS_CONNECTION_STRING -R "$GH_REPO" --env "$GH_ENVIRONMENT" >/dev/null 2>&1 || true

# Torn-down checklist (docs/staging-env.md §4).
fail=0
if [[ "$(az group exists -n "$STAGING_RG")" == "true" ]]; then
  warn "$STAGING_RG still exists (deletion may still be in progress: az group show -n $STAGING_RG)"
  fail=1
fi
if [[ -n "$KV_NAME" && -n "$(az keyvault list-deleted --query "[?name=='$KV_NAME'].name" -o tsv)" ]]; then
  warn "vault $KV_NAME is still soft-deleted (purge it: az keyvault purge --name $KV_NAME)"
  fail=1
fi
leftover="$(az sql db list -g "$PROD_RG" --subscription "$PROD_SUBSCRIPTION_ID" --query "[?starts_with(name, 'femme_app_db_stgcopy')].name" -o tsv 2>/dev/null || true)"
if [[ -n "$leftover" ]]; then
  warn "temporary prod PITR copy still exists: $leftover (scripts/staging/export-prod-snapshot.sh normally deletes it)"
  fail=1
fi
((fail == 0)) || die "teardown incomplete — see warnings above"
log "staging is gone: no $STAGING_RG, no soft-deleted vault, v2-staging secrets cleared"
