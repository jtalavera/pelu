#!/usr/bin/env bash
# Self-test for the parity guard (T2 acceptance): changing backend_max_replicas in prod only must
# fail the check; mirroring it in staging must make it pass again. Also checks a few safety rules.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVS="$HERE/../../infrastructure_v2/environments"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

run() { python3 "$HERE/parity.py" --prod "$TMP/prod.tfvars" --staging "$TMP/staging.tfvars" check >/dev/null 2>&1; }
reset() { cp "$ENVS/prod/terraform.tfvars" "$TMP/prod.tfvars"; cp "$ENVS/staging/terraform.tfvars" "$TMP/staging.tfvars"; }
expect() { # expect pass|fail "description"
  local want="$1" what="$2" got=pass
  run || got=fail
  if [[ "$got" != "$want" ]]; then echo "FAIL: $what (expected $want, got $got)"; exit 1; fi
  echo "ok:   $what → $got"
}

reset; expect pass "current repo tfvars"

reset
sed -i 's/^backend_max_replicas = 1/backend_max_replicas = 2/' "$TMP/prod.tfvars"
expect fail "prod backend_max_replicas changed, staging not"
sed -i 's/^backend_max_replicas = 1/backend_max_replicas = 2/' "$TMP/staging.tfvars"
expect pass "same change mirrored in staging"

reset
echo 'backend_report_warmup_enabled = false' >> "$TMP/staging.tfvars"
expect fail "staging disables report warmup (prod relies on the default true)"

reset
sed -i 's/^sifen_environment = "TEST"/sifen_environment = "PRODUCTION"/' "$TMP/staging.tfvars"
expect fail "staging sifen_environment = PRODUCTION"

reset
sed -i 's/^manage_resource_providers = false/manage_resource_providers = true/' "$TMP/staging.tfvars"
expect fail "staging manages subscription provider registrations"

reset
echo 'log_analytics_daily_quota_gb = 5' >> "$TMP/prod.tfvars"
expect fail "prod Log Analytics cap changed (last assignment wins), staging not"

reset
echo 'stock_api_base_url = "https://stock.example"' >> "$TMP/prod.tfvars"
expect pass "prod gets a Stock URL — staging must stay empty (allowed deviation)"

echo "All parity self-tests passed."
