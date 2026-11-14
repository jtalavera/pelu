#!/usr/bin/env bash
# T6 (docs/staging-env.md): generate a golden multi-tenant load-test DB into the CURRENT staging
# environment and export it as loadtest/loadtest-V<flyway>-t<N>-s<M>.bacpac.
#
#   # fresh:  bring up an empty staging first, then seed it
#   scripts/staging/up.sh --data=empty --ref=develop
#   scripts/staging/seed-golden-db.sh --tenants=20 --sifen-tenants=2
#
#   # grow:   bring up the smaller golden DB, then add blocks of 10
#   scripts/staging/up.sh --data=loadtest --bacpac=loadtest-V120-t10-s2 --ref=develop
#   scripts/staging/seed-golden-db.sh --tenants=30 --sifen-tenants=2 --from-bacpac=loadtest-V120-t10-s2
#
#   # resume: phase 1 (API provisioning) finished but a history file failed — fix it and rerun
#   # with the same --tenants/--sifen-tenants; files already applied (*.sql.done) are skipped
#   scripts/staging/seed-golden-db.sh --tenants=10 --sifen-tenants=0 --resume=loadtest/seed/out/<ts>
#
#   scripts/staging/down.sh
#
# Environment: SEED_USER_PASSWORD (tenant admins' password at generation time; up.sh resets every
# user to STAGING_USER_PASSWORD on import), SEED_PLATFORM_ADMIN_EMAIL / SEED_PLATFORM_ADMIN_PASSWORD
# (default: STAGING_PLATFORM_ADMIN_* for a fresh DB; for a grown DB use the imported admin's
# e-mail and STAGING_USER_PASSWORD). Tools: node 20, go-sqlcmd, sqlpackage, az, terraform, jq.
#
# SIFEN tenants copy the dev tenant "Femme Coiffure": issuer data and timbrado are READ from the
# dev DB, its .p12/password/CSC from the dev Key Vault; nothing in dev changes. Its contact e-mail
# and phone are NOT copied (rewritten to the sanitized values).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

TENANTS="" SIFEN="0" FROM_BACPAC="" RESUME=""
for arg in "$@"; do
  case "$arg" in
    --tenants=*) TENANTS="${arg#*=}" ;;
    --sifen-tenants=*) SIFEN="${arg#*=}" ;;
    --from-bacpac=*) FROM_BACPAC="${arg#*=}"; FROM_BACPAC="${FROM_BACPAC%.bacpac}" ;;
    --resume=*) RESUME="${arg#*=}" ;;
    -h | --help) sed -n '2,28p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done
[[ -n "$TENANTS" ]] || die "--tenants=N is required (multiple of 10)"

require_cmd node az terraform jq sqlpackage
require_go_sqlcmd
ensure_subscription "$STAGING_SUBSCRIPTION_ID"
require_env SEED_USER_PASSWORD
export SEED_PLATFORM_ADMIN_EMAIL="${SEED_PLATFORM_ADMIN_EMAIL:-${STAGING_PLATFORM_ADMIN_EMAIL:-}}"
export SEED_PLATFORM_ADMIN_PASSWORD="${SEED_PLATFORM_ADMIN_PASSWORD:-${STAGING_PLATFORM_ADMIN_PASSWORD:-}}"
require_env SEED_PLATFORM_ADMIN_EMAIL SEED_PLATFORM_ADMIN_PASSWORD
[[ "$(az group exists -n "$STAGING_RG")" == "true" ]] || die "$STAGING_RG does not exist — run up.sh first (see --help)"

SEED_DIR="$REPO_ROOT/loadtest/seed"
if [[ -n "$RESUME" ]]; then
  OUT="$(cd "$RESUME" && pwd)" || die "--resume: no such directory: $RESUME"
  [[ -f "$OUT/users.json" ]] && compgen -G "$OUT/history-t*.sql" >/dev/null \
    || die "--resume: $OUT has no users.json/history-t*.sql — phase 1 did not finish, start fresh"
  [[ "$(jq '.tenants | length' "$OUT/users.json")" == "$TENANTS" ]] \
    || die "--resume: $OUT was generated for a different --tenants"
else
  OUT="$SEED_DIR/out/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$OUT"
fi
TMP="$(mktemp -d)"
chmod 700 "$TMP"
trap 'rm -rf "$TMP"' EXIT

log "size estimate"
node "$SEED_DIR/seed.mjs" --estimate-only --tenants="$TENANTS" >"$OUT/estimate.json"

tf_staging_init
SQL_SERVER="$(tf_out sql_server_fqdn)"
SQL_DB="$(tf_out sql_database_name)"
API_URL="$(tf_out container_app_fqdn)"

FROM_TENANTS=0
SEED_ARGS=(--api="$API_URL" --tenants="$TENANTS" --sifen-tenants="$SIFEN" --out="$OUT")
if [[ -n "$FROM_BACPAC" ]]; then
  blob_download "$LOADTEST_CONTAINER" "$FROM_BACPAC.users.json" "$OUT/base-users.json"
  FROM_TENANTS="$(jq '.tenants | length' "$OUT/base-users.json")"
  SEED_ARGS+=(--from-tenants="$FROM_TENANTS" --base-users="$OUT/base-users.json")
fi

# Issuer file (only when new SIFEN tenants are created).
if [[ -z "$RESUME" ]] && ((SIFEN > FROM_TENANTS)); then
  log "reading Femme Coiffure's issuer data, timbrado, CSC and certificate from dev (read-only)"
  DEV_SQL="$(az sql server list -g "$DEV_RG" --query '[0].fullyQualifiedDomainName' -o tsv)"
  DEV_KV="$(az keyvault list -g "$DEV_RG" --query '[0].name' -o tsv)"
  DEV_TENANT="$(sql_query "$DEV_SQL" "$SQL_DB_NAME" "SELECT id FROM tenants WHERE name = N'$SIFEN_DEV_TENANT_NAME'" | tr -d '[:space:]')"
  [[ "$DEV_TENANT" =~ ^[0-9]+$ ]] || die "dev tenant '$SIFEN_DEV_TENANT_NAME' not found"
  BUSINESS="$(sql_query "$DEV_SQL" "$SQL_DB_NAME" "SELECT business_name AS businessName, ruc, address, N'$SANITIZED_PHONE' AS phone, N'lt-issuer@loadtest.invalid' AS contactEmail, taxpayer_type AS taxpayerType, economic_activity_code AS economicActivityCode, economic_activity_description AS economicActivityDescription, sifen_department_code AS sifenDepartmentCode, sifen_department_name AS sifenDepartmentName, sifen_city_code AS sifenCityCode, sifen_city_name AS sifenCityName, sifen_fantasy_name AS sifenFantasyName FROM business_profiles WHERE tenant_id = $DEV_TENANT FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES" | tr -d '\n')"
  STAMP="$(sql_query "$DEV_SQL" "$SQL_DB_NAME" "SELECT TOP 1 stamp_number AS stampNumber, CONVERT(NVARCHAR(10), valid_from, 23) AS validFrom, CONVERT(NVARCHAR(10), valid_until, 23) AS validUntil, establishment, expedition_point AS expeditionPoint FROM fiscal_stamps WHERE tenant_id = $DEV_TENANT AND active = 1 FOR JSON PATH, WITHOUT_ARRAY_WRAPPER, INCLUDE_NULL_VALUES" | tr -d '\n')"
  IFS=$'\t' read -r CSC_ID CSC_NAME CSC_VER <<<"$(sql_query "$DEV_SQL" "$SQL_DB_NAME" "SELECT TOP 1 id_csc, secret_name, secret_version FROM sifen_csc WHERE tenant_id = $DEV_TENANT AND active = 1")"
  IFS=$'\t' read -r P12N P12V PWDN PWDV <<<"$(sql_query "$DEV_SQL" "$SQL_DB_NAME" "SELECT TOP 1 p12_secret_name, p12_secret_version, password_secret_name, password_secret_version FROM sifen_certificates WHERE tenant_id = $DEV_TENANT ORDER BY uploaded_at DESC")"
  [[ -n "${CSC_VER:-}" && -n "${PWDV:-}" ]] || die "Femme Coiffure needs an active CSC and a certificate in dev"
  az keyvault secret download --vault-name "$DEV_KV" --name "$CSC_NAME" --version "$CSC_VER" --file "$TMP/csc" --encoding utf-8
  az keyvault secret download --vault-name "$DEV_KV" --name "$P12N" --version "$P12V" --file "$TMP/p12.b64" --encoding utf-8
  az keyvault secret download --vault-name "$DEV_KV" --name "$PWDN" --version "$PWDV" --file "$TMP/pwd" --encoding utf-8
  base64 -d "$TMP/p12.b64" >"$TMP/cert.p12"
  jq -n --argjson business "$BUSINESS" --argjson stamp "$STAMP" --argjson idCsc "$CSC_ID" \
    --rawfile csc "$TMP/csc" --arg p12 "$TMP/cert.p12" --arg pwd "$TMP/pwd" \
    '{business: $business, stamp: $stamp, csc: {idCsc: $idCsc, value: $csc}, cert: {p12Path: $p12, passwordPath: $pwd}}' \
    >"$TMP/issuer.json"
  SEED_ARGS+=(--issuer="$TMP/issuer.json")
fi

if [[ -n "$RESUME" ]]; then
  log "phase 1: skipped (--resume $OUT)"
else
  log "phase 1: provisioning tenants through the API ($API_URL)"
  node "$SEED_DIR/seed.mjs" "${SEED_ARGS[@]}"
fi

# Each history file is one transaction (XACT_ABORT), so it is applied entirely or not at all;
# the .done marker makes --resume skip the ones already in.
log "phase 2: bulk history SQL"
for f in "$OUT"/history-t*.sql; do
  if [[ -f "$f.done" ]]; then
    log "  $(basename "$f"): already applied"
    continue
  fi
  sql_file "$SQL_SERVER" "$SQL_DB" "$f"
  touch "$f.done"
done

ANCHOR="$(jq -r .anchor "$OUT/users.json")"
VOLUMES_VERSION="$(jq -r .generator.volumesVersion "$OUT/users.json")"
sql_query "$SQL_SERVER" "$SQL_DB" "IF OBJECT_ID('loadtest_meta') IS NULL CREATE TABLE loadtest_meta (k NVARCHAR(64) PRIMARY KEY, v NVARCHAR(400) NOT NULL);
  MERGE loadtest_meta t USING (VALUES ('anchor_date', N'$ANCHOR'), ('volumes_version', N'$VOLUMES_VERSION'), ('tenants', N'$TENANTS'), ('sifen_tenants', N'$SIFEN')) s(k, v)
  ON t.k = s.k WHEN MATCHED THEN UPDATE SET v = s.v WHEN NOT MATCHED THEN INSERT (k, v) VALUES (s.k, s.v);" >/dev/null

SIZE_MB="$(sql_query "$SQL_SERVER" "$SQL_DB" "SELECT CAST(SUM(reserved_page_count) * 8 / 1024.0 AS DECIMAL(10,1)) FROM sys.dm_db_partition_stats" | tr -d '[:space:]')"
VERSION="$(flyway_version "$SQL_SERVER" "$SQL_DB")"
NAME="loadtest-V${VERSION}-t${TENANTS}-s${SIFEN}"
log "actual DB size: ${SIZE_MB} MB (estimate: $(jq -r '.totalBytes / 1048576 | floor' "$OUT/estimate.json") MB)"

log "exporting $NAME.bacpac"
sqlpackage /Action:Export /SourceServerName:"$SQL_SERVER" /SourceDatabaseName:"$SQL_DB" \
  /AccessToken:"$(sql_access_token)" /TargetFile:"$TMP/$NAME.bacpac" /SourceTrustServerCertificate:False
jq --arg b "$NAME" --arg size "$SIZE_MB" --arg v "$VERSION" '.bacpac = $b | .flywayVersion = $v | .actualSizeMb = ($size | tonumber)' \
  "$OUT/users.json" >"$OUT/$NAME.users.json"
blob_upload "$LOADTEST_CONTAINER" "$NAME.bacpac" "$TMP/$NAME.bacpac"
blob_upload "$LOADTEST_CONTAINER" "$NAME.users.json" "$OUT/$NAME.users.json"
log "done: $LOADTEST_CONTAINER/$NAME.bacpac (${SIZE_MB} MB). Record the size in loadtest/reports/ when you use it."
echo "  Next: scripts/staging/up.sh --recreate --data=loadtest --bacpac=$NAME --ref=<ref>"
