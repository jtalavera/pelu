#!/usr/bin/env bash
# Bring up the disposable prod-parity staging environment (docs/staging-env.md, T3).
#
#   scripts/staging/up.sh --data=prod|loadtest|empty --ref=<branch or tag> [options]
#
# Options:
#   --data=prod        import the newest sanitized-on-import prod snapshot (or --bacpac=<name>)
#   --data=loadtest    import a golden load-test DB: --bacpac=loadtest-V<v>-t<N>-s<M> (required)
#   --data=empty       fresh DB; Flyway builds the schema on first boot
#   --ref=<ref>        branch or tag to deploy (gh workflow run needs a branch/tag, not a SHA).
#                      Its deploy-v2.yml must already offer the v2-staging option.
#   --bacpac=<name>    blob name (without .bacpac) in the snapshots/ or loadtest/ container
#   --recreate         run down.sh first if femme-staging-rg exists
#   --tf-var K=V       WHAT-IF sizing override (repeatable). Never committed; recorded in the run
#                      report as an explicitly labeled deviation from prod.
#   --yes              no interactive confirmations (terraform apply runs with -auto-approve)
#
# Required environment (never commit these):
#   STAGING_PLATFORM_ADMIN_EMAIL     platform admin bootstrapped on an empty DB (--data=empty)
#   STAGING_PLATFORM_ADMIN_PASSWORD  its password
#   STAGING_USER_PASSWORD            shared password every imported user gets (--data=prod|loadtest)
#
# Tools: az, terraform, gh, jq, git, curl, python3, go-sqlcmd, sqlpackage (prod/loadtest),
# and a BCrypt helper (python3 bcrypt, htpasswd, or `npm ci` in loadtest/seed).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DATA="" REF="" BACPAC="" RECREATE=0 TF_OVERRIDES=()
for arg in "$@"; do
  case "$arg" in
    --data=*) DATA="${arg#*=}" ;;
    --ref=*) REF="${arg#*=}" ;;
    --bacpac=*) BACPAC="${arg#*=}"; BACPAC="${BACPAC%.bacpac}" ;;
    --recreate) RECREATE=1 ;;
    --tf-var) die "use --tf-var=KEY=VALUE" ;;
    --tf-var=*) TF_OVERRIDES+=("${arg#*=}") ;;
    --yes) export ASSUME_YES=1 ;;
    -h | --help) sed -n '2,30p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg (see --help)" ;;
  esac
done
[[ "$DATA" =~ ^(prod|loadtest|empty)$ ]] || die "--data must be prod, loadtest or empty"
[[ -n "$REF" ]] || die "--ref=<branch or tag> is required"
[[ "$DATA" != "loadtest" || -n "$BACPAC" ]] || die "--data=loadtest needs --bacpac=loadtest-V<v>-t<N>-s<M>"

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$WORK_DIR/runs/$RUN_ID"
mkdir -p "$RUN_DIR"
chmod 700 "$WORK_DIR" "$RUN_DIR"
SECRETS_TMP="$(mktemp -d)"
chmod 700 "$SECRETS_TMP"
trap 'rm -rf "$SECRETS_TMP"' EXIT
REPORT="$RUN_DIR/report.md"
report() { printf '%s\n' "$*" >>"$REPORT"; }
START_EPOCH="$(date +%s)"

# =============================================================================================
# 1. Preflight
# =============================================================================================
log "1/8 preflight"
require_cmd az terraform gh jq git curl python3
require_go_sqlcmd
[[ "$DATA" == "empty" ]] || require_cmd sqlpackage
require_env STAGING_PLATFORM_ADMIN_EMAIL STAGING_PLATFORM_ADMIN_PASSWORD
[[ "$DATA" == "empty" ]] || require_env STAGING_USER_PASSWORD

ensure_subscription "$STAGING_SUBSCRIPTION_ID"
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"

grep -Eq '^\s*sifen_environment\s*=\s*"TEST"' "$STAGING_TFVARS" \
  || die "staging tfvars must set sifen_environment = \"TEST\" — refusing to continue"
for kv in "${TF_OVERRIDES[@]}"; do
  [[ "${kv%%=*}" =~ ^(sifen_environment|environment|subscription_id|manage_resource_providers|key_vault_purge_protection_enabled|stock_api_base_url|email_custom_domain|frontend_custom_domains)$ ]] \
    && die "--tf-var may only override sizing, not ${kv%%=*}"
done

"$STAGING_DIR/check-parity.sh" --live

git -C "$REPO_ROOT" fetch --quiet origin "$REF" || die "cannot fetch ref '$REF' from origin"
REF_COMMIT="$(git -C "$REPO_ROOT" rev-parse FETCH_HEAD)"
REF_DEPLOY_WORKFLOW="$(git -C "$REPO_ROOT" show "$REF_COMMIT:.github/workflows/deploy-v2.yml")"
[[ "$REF_DEPLOY_WORKFLOW" == *v2-staging* ]] \
  || die "ref '$REF' predates the v2-staging deploy option (deploy-v2.yml) — merge develop into it first"
EXPECTED_FLYWAY="$(expected_flyway_version "$REF_COMMIT")"

if [[ "$(az group exists -n "$STAGING_RG")" == "true" ]]; then
  ((RECREATE)) || die "$STAGING_RG already exists — run scripts/staging/down.sh or pass --recreate"
  log "--recreate: tearing down the existing staging environment first"
  "$STAGING_DIR/down.sh" ${ASSUME_YES:+--yes}
fi

TF_VAR_ARGS=()
CURRENT_IP="$(my_public_ip || true)"
TFVARS_IP="$(sed -nE 's/^\s*deployer_ip\s*=\s*"([^"]+)".*/\1/p' "$STAGING_TFVARS")"
if [[ -n "$CURRENT_IP" && "$CURRENT_IP" != "$TFVARS_IP" ]]; then
  warn "deployer_ip in tfvars ($TFVARS_IP) differs from this machine ($CURRENT_IP): using $CURRENT_IP for the SQL firewall"
  TF_VAR_ARGS+=(-var "deployer_ip=$CURRENT_IP")
fi
for kv in "${TF_OVERRIDES[@]}"; do TF_VAR_ARGS+=(-var "$kv"); done

{
  echo "# Staging run $RUN_ID"
  echo
  echo "| | |"
  echo "|---|---|"
  echo "| Data mode | \`$DATA\` |"
  echo "| BACPAC | \`${BACPAC:-—}\` |"
  echo "| Ref | \`$REF\` (\`${REF_COMMIT:0:12}\`) |"
  echo "| Expected Flyway version | V$EXPECTED_FLYWAY |"
  if ((${#TF_OVERRIDES[@]})); then
    echo "| **WHAT-IF overrides (not prod parity)** | \`${TF_OVERRIDES[*]}\` |"
  else
    echo "| Sizing | prod parity (no overrides) |"
  fi
  echo
} >"$REPORT"

# =============================================================================================
# 2. Terraform
# =============================================================================================
log "2/8 terraform apply ($STAGING_RG)"
tf_staging_init
APPLY_ARGS=(-input=false -var-file="environments/staging/terraform.tfvars" "${TF_VAR_ARGS[@]}")
[[ "${ASSUME_YES:-0}" == "1" ]] && APPLY_ARGS+=(-auto-approve)
terraform -chdir="$INFRA_DIR" apply "${APPLY_ARGS[@]}"

SQL_SERVER="$(tf_out sql_server_fqdn)"
SQL_DB="$(tf_out sql_database_name)"
KV_NAME="$(tf_out key_vault_name)"
API_URL="$(tf_out container_app_fqdn)"
SWA_HOST="$(tf_out static_web_app_default_host_name)"
[[ "$(tf_out resource_group_name)" == "$STAGING_RG" ]] || die "terraform output resource_group_name is not $STAGING_RG"
report "| Resource | Value |"
report "|---|---|"
report "| SQL server | \`$SQL_SERVER\` |"
report "| Key Vault | \`$KV_NAME\` |"
report "| API | $API_URL |"
report "| SPA | https://$SWA_HOST |"
report ""

# =============================================================================================
# 3. Data restore (the container still runs the hello-world image: Flyway hasn't touched the DB)
# =============================================================================================
import_bacpac() { # import_bacpac <container> <blob name>
  local file="$WORK_DIR/bacpacs/$2"
  mkdir -p "$WORK_DIR/bacpacs"
  chmod 700 "$WORK_DIR/bacpacs"
  log "downloading $1/$2"
  blob_download "$1" "$2" "$file"
  log "sqlpackage import into $SQL_DB (Basic 5 DTU: this is slow)"
  local t0
  t0="$(date +%s)"
  sqlpackage /Action:Import /SourceFile:"$file" /TargetServerName:"$SQL_SERVER" \
    /TargetDatabaseName:"$SQL_DB" /AccessToken:"$(sql_access_token)" /TargetTrustServerCertificate:False
  report "- BACPAC import: $(($(date +%s) - t0)) s"
  if [[ "$1" == "$SNAPSHOT_CONTAINER" ]]; then rm -f "$file"; fi # never keep prod data on the laptop
}

USER_HASH=""
if [[ "$DATA" != "empty" ]]; then
  USER_HASH="$(bcrypt_hash "$STAGING_USER_PASSWORD")"
fi
SANITIZE_VARS=("EmailDomain=$SANITIZED_EMAIL_DOMAIN" "Phone=$SANITIZED_PHONE" "PasswordHash=$USER_HASH")

case "$DATA" in
  empty)
    log "3/8 --data=empty: Flyway will build the schema on first boot"
    ;;
  prod)
    log "3/8 importing a prod snapshot"
    if [[ -z "$BACPAC" ]]; then
      BACPAC="$(az storage blob list --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" \
        --subscription "$STAGING_SUBSCRIPTION_ID" -c "$SNAPSHOT_CONTAINER" --prefix prod- \
        --query 'sort_by([], &properties.creationTime)[-1].name' -o tsv)"
      BACPAC="${BACPAC%.bacpac}"
      [[ -n "$BACPAC" ]] || die "no prod snapshot in $SNAPSHOT_CONTAINER/ — run scripts/staging/export-prod-snapshot.sh"
      log "newest snapshot: $BACPAC"
    fi
    import_bacpac "$SNAPSHOT_CONTAINER" "$BACPAC.bacpac"
    log "sanitizing (mandatory)"
    sql_file "$SQL_SERVER" "$SQL_DB" "$STAGING_DIR/sql/sanitize-prod-snapshot.sql" "${SANITIZE_VARS[@]}" | tee "$RUN_DIR/sanitize.log"
    ;;
  loadtest)
    log "3/8 importing golden load-test DB $BACPAC"
    import_bacpac "$LOADTEST_CONTAINER" "$BACPAC.bacpac"
    blob_download "$LOADTEST_CONTAINER" "$BACPAC.users.json" "$RUN_DIR/users.json"
    log "resetting every user to the shared staging password"
    sql_query "$SQL_SERVER" "$SQL_DB" "UPDATE app_users SET password_hash = N'$USER_HASH';" >/dev/null
    log "shifting history dates by whole weeks so today's agenda is populated"
    sql_file "$SQL_SERVER" "$SQL_DB" "$STAGING_DIR/sql/shift-loadtest-dates.sql" | tee -a "$RUN_DIR/import.log"
    ;;
esac
DATA_READY_UTC="$(date -u '+%Y-%m-%d %H:%M:%S')"

if [[ "$DATA" == "prod" ]]; then
  VERIFY_OUT="$(sql_file "$SQL_SERVER" "$SQL_DB" "$STAGING_DIR/sql/verify-sanitized.sql" "${SANITIZE_VARS[@]}")"
  printf '%s\n' "$VERIFY_OUT" | tee "$RUN_DIR/verify-sanitized.log"
  grep -q '^VIOLATIONS=0$' <<<"$VERIFY_OUT" \
    || die "sanitization verification FAILED — NOT deploying. Run scripts/staging/down.sh to discard the data."
  report "- Sanitization: verified (0 real e-mails/phones, no certificates, no tokens)"
fi

# =============================================================================================
# 3b. Load-test only: rebase SIFEN numbering and re-link certificates (T6)
# =============================================================================================
if [[ "$DATA" == "loadtest" ]]; then
  # shellcheck source=sifen-loadtest.sh
  source "$STAGING_DIR/sifen-loadtest.sh"
  sifen_rebase_and_relink "$RUN_DIR/users.json" "$SQL_SERVER" "$SQL_DB" "$KV_NAME"
fi

# =============================================================================================
# 4. Managed-identity DB user
# =============================================================================================
log "4/8 granting the Container App's managed identity on $SQL_DB"
retry 10 30 sql_file "$SQL_SERVER" "$SQL_DB" "$STAGING_DIR/sql/grant-mi-user.sql" "AppName=$CONTAINER_APP_NAME" \
  || die "could not create the managed-identity DB user"

# =============================================================================================
# 5. Secrets: JWT (fresh, random) + platform-admin bootstrap credentials
# =============================================================================================
log "5/8 seeding app-femme-jwt-secret (fresh random value) — waiting for Key Vault RBAC to propagate"
openssl rand -base64 48 | tr -d '\n' >"$SECRETS_TMP/jwt"
retry 12 30 az keyvault secret set --vault-name "$KV_NAME" --name app-femme-jwt-secret \
  --file "$SECRETS_TMP/jwt" --encoding utf-8 --only-show-errors -o none \
  || die "could not write app-femme-jwt-secret (is your account in femme-sql-admins?)"

# PlatformAdminBootstrap only runs on a DB with zero PLATFORM_ADMIN users (--data=empty); for
# imported data the admin already exists and has the shared staging password. Kept as a Container
# App secret (never in tfvars/state). A later `terraform apply` drops it — harmless after boot.
log "setting the platform-admin bootstrap credentials on the Container App"
az containerapp secret set -n "$CONTAINER_APP_NAME" -g "$STAGING_RG" \
  --secrets "platform-admin-password=$STAGING_PLATFORM_ADMIN_PASSWORD" --only-show-errors -o none
az containerapp update -n "$CONTAINER_APP_NAME" -g "$STAGING_RG" --only-show-errors -o none \
  --set-env-vars "APP_FEMME_PLATFORM_ADMIN_EMAIL=$STAGING_PLATFORM_ADMIN_EMAIL" \
  "APP_FEMME_PLATFORM_ADMIN_PASSWORD=secretref:platform-admin-password"

# =============================================================================================
# 6. GitHub Environment v2-staging
# =============================================================================================
log "6/8 updating GitHub Environment $GH_ENVIRONMENT"
gh_secret() { printf '%s' "$2" | gh secret set "$1" -R "$GH_REPO" --env "$GH_ENVIRONMENT" >/dev/null; }
gh_secret AZURE_STATIC_WEB_APPS_API_TOKEN "$(tf_out static_web_app_api_key)"
gh_secret VITE_API_BASE_URL "$API_URL"
gh_secret AZURE_RESOURCE_GROUP_NAME "$STAGING_RG"
gh_secret AZURE_CONTAINER_APP_NAME "$CONTAINER_APP_NAME"
gh_secret LOADTEST_BASE_URL "$API_URL"
gh variable set VITE_APPINSIGHTS_CONNECTION_STRING -R "$GH_REPO" --env "$GH_ENVIRONMENT" \
  --body "$(tf_out app_insights_connection_string)" >/dev/null
if [[ "$DATA" == "loadtest" ]]; then
  jq -c --arg pw "$STAGING_USER_PASSWORD" '{bacpac, tenants: [.tenants[] | {id, sifen, sifenIndex,
      users: [.users[] | {email, role}]}], password: $pw}' "$RUN_DIR/users.json" >"$SECRETS_TMP/users.json"
  gh secret set LOADTEST_USERS_JSON -R "$GH_REPO" --env "$GH_ENVIRONMENT" <"$SECRETS_TMP/users.json" >/dev/null
fi

# =============================================================================================
# 7. Deploy the ref (deploy-v2.yml → deploy-azure.yml, built exactly like prod)
# =============================================================================================
log "7/8 dispatching deploy-v2.yml for $REF → $GH_ENVIRONMENT"
DISPATCHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
gh workflow run deploy-v2.yml -R "$GH_REPO" --ref "$REF" -f environment="$GH_ENVIRONMENT"
RUN_DB_ID=""
for _ in $(seq 1 30); do
  sleep 5
  RUN_DB_ID="$(gh run list -R "$GH_REPO" --workflow deploy-v2.yml --event workflow_dispatch --limit 10 \
    --json databaseId,createdAt,headBranch \
    --jq "[.[] | select(.createdAt >= \"$DISPATCHED_AT\" and .headBranch == \"$REF\")] | sort_by(.createdAt) | .[0].databaseId // empty")"
  [[ -n "$RUN_DB_ID" ]] && break
done
[[ -n "$RUN_DB_ID" ]] || die "could not find the dispatched deploy-v2.yml run"
RUN_URL="https://github.com/$GH_REPO/actions/runs/$RUN_DB_ID"
log "deploy run: $RUN_URL"
log "v2-staging has a required reviewer: approve the deployment there. Waiting up to 90 min…"
report "- Deploy run: $RUN_URL"
DEPLOY_T0="$(date +%s)"
timeout 5400 gh run watch "$RUN_DB_ID" -R "$GH_REPO" --exit-status --interval 30 >/dev/null \
  || die "deploy run failed or timed out: $RUN_URL"
report "- Deploy (incl. approval wait): $(($(date +%s) - DEPLOY_T0)) s"

# =============================================================================================
# 8. Smoke test
# =============================================================================================
log "8/8 smoke test"
health_ok() { [[ "$(http_status "$API_URL/health")" == "200" ]]; }
COLD_T0="$(date +%s)"
retry 40 15 health_ok || die "/health did not return 200 (first revision may still be crash-looping on RBAC propagation — check: az containerapp logs show -n $CONTAINER_APP_NAME -g $STAGING_RG --type system)"
report "- /health 200 after: $(($(date +%s) - COLD_T0)) s (includes cold start)"

if [[ "$DATA" == "empty" ]]; then
  LOGIN_EMAIL="$STAGING_PLATFORM_ADMIN_EMAIL" LOGIN_PASSWORD="$STAGING_PLATFORM_ADMIN_PASSWORD"
else
  LOGIN_EMAIL="$(sql_query "$SQL_SERVER" "$SQL_DB" "SELECT TOP 1 email FROM app_users WHERE role = 'PLATFORM_ADMIN' AND enabled = 1 ORDER BY id" | tr -d '[:space:]')"
  LOGIN_PASSWORD="$STAGING_USER_PASSWORD"
  [[ -n "$LOGIN_EMAIL" ]] || die "no enabled PLATFORM_ADMIN in the imported data"
fi
jq -n --arg e "$LOGIN_EMAIL" --arg p "$LOGIN_PASSWORD" '{email: $e, password: $p}' >"$SECRETS_TMP/login.json"
LOGIN_STATUS="$(http_status -X POST -H 'Content-Type: application/json' --data @"$SECRETS_TMP/login.json" "$API_URL/api/auth/login")"
[[ "$LOGIN_STATUS" == "200" ]] || die "platform-admin login returned HTTP $LOGIN_STATUS"
report "- Platform-admin login: OK"

ACTUAL_FLYWAY="$(flyway_version "$SQL_SERVER" "$SQL_DB")"
[[ "$ACTUAL_FLYWAY" == "$EXPECTED_FLYWAY" ]] || die "Flyway is at V$ACTUAL_FLYWAY, expected V$EXPECTED_FLYWAY"
report "- Flyway: V$ACTUAL_FLYWAY (expected V$EXPECTED_FLYWAY) ✓"

if [[ "$DATA" != "empty" ]]; then
  report ""
  report "## Migration rehearsal (migrations applied on boot over the imported data)"
  report ""
  report "| Version | Description | ms | Success |"
  report "|---|---|---|---|"
  sql_query "$SQL_SERVER" "$SQL_DB" "SELECT version, description, execution_time, success FROM flyway_schema_history WHERE installed_on >= '$DATA_READY_UTC' ORDER BY installed_rank" \
    | awk -F'\t' 'NF>=4 {printf "| V%s | %s | %s | %s |\n", $1, $2, $3, $4}' >>"$REPORT"
  sql_query "$SQL_SERVER" "$SQL_DB" "SELECT COALESCE(t.name, '(platform)'), u.role, u.email FROM app_users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.role IN ('PLATFORM_ADMIN', 'ADMIN') ORDER BY t.name, u.role" \
    >"$RUN_DIR/accounts.tsv"
fi

report ""
report "Total: $(($(date +%s) - START_EPOCH)) s"
log "staging is up"
echo
echo "  SPA:    https://$SWA_HOST"
echo "  API:    $API_URL"
echo "  Report: $REPORT"
[[ -f "$RUN_DIR/accounts.tsv" ]] && echo "  Logins: $RUN_DIR/accounts.tsv (password: \$STAGING_USER_PASSWORD)"
echo "  Tear down when done: scripts/staging/down.sh"
