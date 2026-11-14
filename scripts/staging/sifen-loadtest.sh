# shellcheck shell=bash
# T6 (docs/staging-env.md): SIFEN numbering rebase + certificate/CSC re-link for a golden load-test
# DB. Sourced by up.sh after the BACPAC import (needs lib.sh, $SECRETS_TMP, report()).
#
# All M SIFEN tenants share Femme Coiffure's (dev) RUC, timbrado, establecimiento and punto on
# sifen-test, which remembers every number ever sent. Each SIFEN tenant k gets its own block:
#
#   start(k) = base + k * SIFEN_BLOCK_SIZE        end(k) = start(k) + SIFEN_BLOCK_SIZE - 1
#   base     = roundup(max(dev number + margin, stored high-water mark, SIFEN_NUMBER_FLOOR), 100)
#
# The floor keeps staging far above Femme Coiffure's own dev numbering, which keeps growing from
# the bottom after a run. The new high-water mark (base + M * block) is RESERVED in the persistent
# storage account before anything is sent, so a failed or aborted run never reuses numbers.

sifen_numbering_blob="sifen-numbering.json"

_dev_sql_server() { az sql server list -g "$DEV_RG" --subscription "$STAGING_SUBSCRIPTION_ID" --query '[0].fullyQualifiedDomainName' -o tsv; }
_dev_vault() { az keyvault list -g "$DEV_RG" --subscription "$STAGING_SUBSCRIPTION_ID" --query '[0].name' -o tsv; }

# Writes the exact secret value (no trailing newline) of <vault>/<name>/<version> to <file>.
_kv_download() { # _kv_download <vault> <name> <version> <file>
  rm -f "$4"
  az keyvault secret download --vault-name "$1" --name "$2" --version "$3" --file "$4" --encoding utf-8 --only-show-errors
}

# Sets <vault>/<name> from <file>; prints the new version id.
_kv_set_from_file() { # _kv_set_from_file <vault> <name> <file>
  local id
  id="$(az keyvault secret set --vault-name "$1" --name "$2" --file "$3" --encoding utf-8 --only-show-errors --query id -o tsv)"
  printf '%s' "${id##*/}"
}

sifen_rebase_and_relink() { # sifen_rebase_and_relink <users.json> <staging sql fqdn> <staging db> <staging vault>
  local users="$1" sql="$2" db="$3" vault="$4"
  local dev_sql dev_vault dev_tenant dev_number hwm m base new_hwm

  m="$(jq '[.tenants[] | select(.sifen)] | length' "$users")"
  if ((m == 0)); then
    log "golden DB has no SIFEN tenants: skipping numbering rebase and certificate re-link"
    return 0
  fi

  dev_sql="$(_dev_sql_server)"
  dev_vault="$(_dev_vault)"
  [[ -n "$dev_sql" && -n "$dev_vault" ]] || die "cannot find the dev SQL server / Key Vault in $DEV_RG"
  dev_tenant="$(sql_query "$dev_sql" "$SQL_DB_NAME" "SELECT id FROM tenants WHERE name = N'$SIFEN_DEV_TENANT_NAME'" | tr -d '[:space:]')"
  [[ "$dev_tenant" =~ ^[0-9]+$ ]] || die "dev tenant '$SIFEN_DEV_TENANT_NAME' not found (dev SQL firewall allows only deployer_ip)"
  dev_number="$(sql_query "$dev_sql" "$SQL_DB_NAME" "SELECT COALESCE(MAX(next_emission_number), 0) FROM fiscal_stamps WHERE tenant_id = $dev_tenant" | tr -d '[:space:]')"

  hwm=0
  if blob_exists "$STATE_CONTAINER" "$sifen_numbering_blob"; then
    blob_download "$STATE_CONTAINER" "$sifen_numbering_blob" "$SECRETS_TMP/numbering.json"
    hwm="$(jq -r '.high_water_mark // 0' "$SECRETS_TMP/numbering.json")"
  else
    echo '{"high_water_mark": 0, "runs": []}' >"$SECRETS_TMP/numbering.json"
  fi

  base=$((dev_number + SIFEN_NUMBER_MARGIN))
  if ((hwm > base)); then base=$hwm; fi
  if ((SIFEN_NUMBER_FLOOR > base)); then base=$SIFEN_NUMBER_FLOOR; fi
  base=$(((base + SIFEN_BLOCK_SIZE - 1) / SIFEN_BLOCK_SIZE * SIFEN_BLOCK_SIZE))
  new_hwm=$((base + m * SIFEN_BLOCK_SIZE))
  ((new_hwm - 1 <= SIFEN_NUMBER_MAX)) \
    || die "SIFEN numbering exhausted: base $base + $m blocks passes $SIFEN_NUMBER_MAX — a new timbrado or punto is needed in dev"
  log "SIFEN numbering: dev=$dev_number hwm=$hwm → base=$base, $m blocks of $SIFEN_BLOCK_SIZE, new hwm=$new_hwm"

  # Reserve first.
  jq --argjson hwm "$new_hwm" --argjson base "$base" --argjson m "$m" --arg run "$RUN_ID" --arg bacpac "$BACPAC" \
    '.high_water_mark = $hwm | .runs += [{run: $run, bacpac: $bacpac, base: $base, sifen_tenants: $m, end: ($hwm - 1)}]' \
    "$SECRETS_TMP/numbering.json" >"$SECRETS_TMP/numbering.new.json"
  blob_upload "$STATE_CONTAINER" "$sifen_numbering_blob" "$SECRETS_TMP/numbering.new.json"

  # Rebase each SIFEN tenant's ACTIVE fiscal stamp. History invoices in the BACPAC live on a
  # separate inactive stamp (loadtest/seed), so (fiscal_stamp_id, invoice_number) can't collide.
  local id k start end updated
  report ""
  report "## SIFEN numbering (base $base, high-water mark → $new_hwm)"
  report ""
  report "| Tenant | k | Range |"
  report "|---|---|---|"
  while IFS=$'\t' read -r id k; do
    start=$((base + k * SIFEN_BLOCK_SIZE))
    end=$((start + SIFEN_BLOCK_SIZE - 1))
    updated="$(sql_query "$sql" "$db" "UPDATE fiscal_stamps SET range_from = $start, range_to = $end, next_emission_number = $start, locked_after_invoice = 0 WHERE tenant_id = $id AND active = 1; SELECT @@ROWCOUNT;" | tr -d '[:space:]')"
    [[ "$updated" == "1" ]] || die "tenant $id: expected exactly one active fiscal stamp, updated $updated"
    report "| $id | $k | $start–$end |"
  done < <(jq -r '.tenants[] | select(.sifen) | [.id, .sifenIndex] | @tsv' "$users")

  # Re-link certificates and CSCs: the rows' secrets lived in the previous (purged) staging vault.
  # Re-write Femme Coiffure's CURRENT dev .p12/password/CSC under the names the rows reference.
  local dev_cert dev_csc p12n p12v pwdn pwdv cscn cscv
  dev_cert="$(sql_query "$dev_sql" "$SQL_DB_NAME" "SELECT TOP 1 p12_secret_name, p12_secret_version, password_secret_name, password_secret_version FROM sifen_certificates WHERE tenant_id = $dev_tenant ORDER BY uploaded_at DESC")"
  IFS=$'\t' read -r p12n p12v pwdn pwdv <<<"$dev_cert"
  [[ -n "${pwdv:-}" ]] || die "dev tenant $SIFEN_DEV_TENANT_NAME has no SIFEN certificate"
  _kv_download "$dev_vault" "$p12n" "$p12v" "$SECRETS_TMP/p12"
  _kv_download "$dev_vault" "$pwdn" "$pwdv" "$SECRETS_TMP/pwd"
  dev_csc="$(sql_query "$dev_sql" "$SQL_DB_NAME" "SELECT TOP 1 secret_name, secret_version FROM sifen_csc WHERE tenant_id = $dev_tenant AND active = 1")"
  IFS=$'\t' read -r cscn cscv <<<"$dev_csc"
  [[ -n "${cscv:-}" ]] || die "dev tenant $SIFEN_DEV_TENANT_NAME has no active CSC"
  _kv_download "$dev_vault" "$cscn" "$cscv" "$SECRETS_TMP/csc"

  local cert_id p12_name pwd_name v1 v2 n=0
  while IFS=$'\t' read -r cert_id p12_name pwd_name; do
    [[ -n "$cert_id" ]] || continue
    v1="$(retry 12 30 _kv_set_from_file "$vault" "$p12_name" "$SECRETS_TMP/p12")" || die "cannot write $p12_name to $vault"
    v2="$(_kv_set_from_file "$vault" "$pwd_name" "$SECRETS_TMP/pwd")"
    sql_query "$sql" "$db" "UPDATE sifen_certificates SET p12_secret_version = N'$v1', password_secret_version = N'$v2' WHERE id = $cert_id" >/dev/null
    n=$((n + 1))
  done < <(sql_query "$sql" "$db" "SELECT id, p12_secret_name, password_secret_name FROM sifen_certificates")
  local csc_id csc_name
  while IFS=$'\t' read -r csc_id csc_name; do
    [[ -n "$csc_id" ]] || continue
    v1="$(_kv_set_from_file "$vault" "$csc_name" "$SECRETS_TMP/csc")"
    sql_query "$sql" "$db" "UPDATE sifen_csc SET secret_version = N'$v1' WHERE id = $csc_id" >/dev/null
  done < <(sql_query "$sql" "$db" "SELECT id, secret_name FROM sifen_csc")
  rm -f "$SECRETS_TMP/p12" "$SECRETS_TMP/pwd" "$SECRETS_TMP/csc"
  ((n == m)) || warn "re-linked $n certificate rows for $m SIFEN tenants"
  report ""
  report "- Certificates re-linked from dev ($SIFEN_DEV_TENANT_NAME): $n"
}
