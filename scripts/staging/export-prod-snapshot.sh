#!/usr/bin/env bash
# T5 export (docs/staging-env.md): take a prod snapshot for `up.sh --data=prod`.
#
#   scripts/staging/export-prod-snapshot.sh
#
# 1. Point-in-time restore of the prod DB into a TEMPORARY copy (femme_app_db_stgcopy_<ts>), so the
#    export doesn't load the 5-DTU live database.
# 2. sqlpackage Export with an Entra access token (SQL is Entra-only; `az sql db export` needs SQL
#    auth and won't work).
# 3. Upload to the private persistent account: snapshots/prod-<ts>-V<flyway>.bacpac. A lifecycle
#    rule deletes it after SNAPSHOT_RETENTION_DAYS (7).
# 4. Delete the temporary copy and the local file — always, even on failure.
#
# Requirements: member of femme-sql-admins, read on the prod subscription, the prod SQL firewall
# allows this machine (prod deployer_ip), go-sqlcmd and sqlpackage. The BACPAC contains REAL PII
# until up.sh sanitizes it on import: it never leaves the private storage account and this machine.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_cmd az jq sqlpackage
require_go_sqlcmd

TS="$(date -u +%Y%m%dT%H%M%SZ)"
COPY_DB="femme_app_db_stgcopy_${TS}"
PROD_SERVER="$(az sql server list -g "$PROD_RG" --subscription "$PROD_SUBSCRIPTION_ID" --query '[0].name' -o tsv)"
[[ -n "$PROD_SERVER" ]] || die "no SQL server found in $PROD_RG"
PROD_FQDN="$PROD_SERVER.database.windows.net"
LOCAL_DIR="$(mktemp -d)"
chmod 700 "$LOCAL_DIR"

cleanup() {
  rm -rf "$LOCAL_DIR"
  if az sql db show -g "$PROD_RG" -s "$PROD_SERVER" -n "$COPY_DB" --subscription "$PROD_SUBSCRIPTION_ID" -o none 2>/dev/null; then
    log "deleting temporary copy $COPY_DB"
    az sql db delete -g "$PROD_RG" -s "$PROD_SERVER" -n "$COPY_DB" --subscription "$PROD_SUBSCRIPTION_ID" --yes \
      || warn "could not delete $COPY_DB — delete it by hand (it costs money and holds prod data)"
  fi
}
trap cleanup EXIT

POINT_IN_TIME="$(date -u -d '-10 minutes' +%Y-%m-%dT%H:%M:%SZ)"
log "point-in-time restore of $PROD_SERVER/$SQL_DB_NAME @ $POINT_IN_TIME → $COPY_DB (Basic)"
az sql db restore -g "$PROD_RG" -s "$PROD_SERVER" -n "$SQL_DB_NAME" --dest-name "$COPY_DB" \
  --time "$POINT_IN_TIME" --service-objective Basic --backup-storage-redundancy Local \
  --subscription "$PROD_SUBSCRIPTION_ID" --only-show-errors -o none

VERSION="$(flyway_version "$PROD_FQDN" "$COPY_DB")"
NAME="prod-${TS}-V${VERSION}.bacpac"
log "exporting $COPY_DB (Flyway V$VERSION) with sqlpackage"
sqlpackage /Action:Export /SourceServerName:"$PROD_FQDN" /SourceDatabaseName:"$COPY_DB" \
  /AccessToken:"$(sql_access_token)" /TargetFile:"$LOCAL_DIR/$NAME" /SourceTrustServerCertificate:False

log "uploading to $STAGING_DATA_ACCOUNT/$SNAPSHOT_CONTAINER/$NAME (expires after $SNAPSHOT_RETENTION_DAYS days)"
blob_upload "$SNAPSHOT_CONTAINER" "$NAME" "$LOCAL_DIR/$NAME"
log "done. Use it with: scripts/staging/up.sh --data=prod --bacpac=${NAME%.bacpac} --ref=<release branch>"
