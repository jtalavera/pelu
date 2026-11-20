#!/usr/bin/env bash
# T7 (docs/staging-env.md): run the k6 load test from THIS machine against the current staging,
# the same way .github/workflows/loadtest.yml does, and store the report in the private
# loadtest-reports/ container so collect-loadtest-metrics.sh works unchanged.
#
#   scripts/staging/run-loadtest.sh --bacpac=loadtest-V99-t10-s0 --ref=<deployed ref> \
#     [--profile=smoke|ramp|soak] [--vus=N --duration=10m] [--sifen-rate=0]
#   scale test (open model, N active tenants, 90 % of them SIFEN when the DB has them):
#     --profile=scale --active=50 [--load=avg|peak] [--duration=15m]
#
# Use it while loadtest.yml can't be dispatched (a workflow_dispatch workflow must exist on the
# default branch) or for quick iterations without the v2-staging approval. Run it from a machine
# in Azure (like the GitHub runners) so client-side latency stays comparable; judge user-facing
# latency from the server-side numbers in metrics.md either way.
#
# Environment: STAGING_USER_PASSWORD (the password up.sh gave every imported user).
# Tools: k6, az, jq, terraform. Writes .staging/loadtest/<prefix>/ (gitignored).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

BACPAC="" REF="" PROFILE="ramp" VUS="" DURATION="" SIFEN_RATE="2" ACTIVE="" LOAD="avg"
for arg in "$@"; do
  case "$arg" in
    --bacpac=*) BACPAC="${arg#*=}"; BACPAC="${BACPAC%.bacpac}" ;;
    --ref=*) REF="${arg#*=}" ;;
    --profile=*) PROFILE="${arg#*=}" ;;
    --vus=*) VUS="${arg#*=}" ;;
    --duration=*) DURATION="${arg#*=}" ;;
    --sifen-rate=*) SIFEN_RATE="${arg#*=}" ;;
    --active=*) ACTIVE="${arg#*=}" ;;
    --load=*) LOAD="${arg#*=}" ;;
    -h | --help) sed -n '2,17p' "$0"; exit 0 ;;
    *) die "unknown argument: $arg" ;;
  esac
done
[[ "$BACPAC" =~ ^loadtest-V[0-9]+-t([0-9]+)-s([0-9]+)$ ]] || die "--bacpac must look like loadtest-V<v>-t<N>-s<M>"
N="${BASH_REMATCH[1]}" M="${BASH_REMATCH[2]}"
[[ -n "$REF" ]] || die "--ref=<deployed branch/tag> is required (recorded in the report)"
[[ "$PROFILE" =~ ^(smoke|ramp|soak|scale)$ ]] || die "--profile must be smoke, ramp, soak or scale"
[[ "$LOAD" =~ ^(avg|peak)$ ]] || die "--load must be avg or peak"
if [[ "$PROFILE" == scale ]]; then
  [[ "$ACTIVE" =~ ^[0-9]+$ && "$ACTIVE" -ge 1 ]] || die "--profile=scale needs --active=<number of active tenants>"
  [[ "$ACTIVE" -le "$N" ]] || die "--active=$ACTIVE is more than the $N tenants in $BACPAC"
  [[ -z "$VUS" ]] || die "--vus is not used by --profile=scale"
  [[ -z "$DURATION" || "$DURATION" =~ ^[0-9]+[smh]$ ]] || die "--duration must look like 15m"
  SIFEN_RATE=0 # scale issues SIFEN invoices inside each iteration, not as a separate stream
fi
[[ -z "$VUS" || "$VUS" =~ ^[0-9]+$ ]] || die "--vus must be a number"
[[ -z "$DURATION" || "$DURATION" =~ ^[0-9]+[smh]$ ]] || die "--duration must look like 10m"
[[ "$PROFILE" == scale || -n "$VUS" && -n "$DURATION" || -z "$VUS$DURATION" ]] || die "--vus and --duration go together"
[[ "$SIFEN_RATE" =~ ^[0-9]+$ ]] || die "--sifen-rate must be a whole number per minute"

require_cmd k6 az jq terraform
require_env STAGING_USER_PASSWORD
ensure_subscription "$STAGING_SUBSCRIPTION_ID"
[[ "$(az group exists -n "$STAGING_RG")" == "true" ]] || die "$STAGING_RG does not exist — run up.sh --data=loadtest first"

tf_staging_init
API_URL="$(tf_out container_app_fqdn)" # already https://…

if [[ "$PROFILE" == scale ]]; then LABEL="scale-${ACTIVE}active-${LOAD}"
elif [[ -n "$VUS" ]]; then LABEL="flat-${VUS}vus-${DURATION}"
else LABEL="$PROFILE"; fi

PREFIX="$(date -u +%Y%m%d)-local$(date -u +%H%M%S)-${BACPAC}"
DIR="$WORK_DIR/loadtest/$PREFIX"
mkdir -p "$DIR"
chmod 700 "$DIR"
SECRETS_TMP="$(mktemp -d)"
chmod 700 "$SECRETS_TMP"
trap 'rm -rf "$SECRETS_TMP"' EXIT

# Users: the golden DB's users file (no password in it) + the shared staging password, the same
# shape up.sh stores in the v2-staging secret LOADTEST_USERS_JSON. Kept out of the report dir.
blob_download "$LOADTEST_CONTAINER" "$BACPAC.users.json" "$SECRETS_TMP/base.json"
jq -c --arg pw "$STAGING_USER_PASSWORD" '{bacpac, tenants: [.tenants[] | {id, sifen, sifenIndex,
    users: [.users[] | {email, role}]}], password: $pw}' "$SECRETS_TMP/base.json" >"$SECRETS_TMP/users.json"

log "k6 → $API_URL (profile=$LABEL, sifen_rate=$SIFEN_RATE, N=$N, M=$M)"
date -u +%Y-%m-%dT%H:%M:%SZ >"$DIR/started_at"
set +e
BASE_URL="$API_URL" USERS_JSON="$(cat "$SECRETS_TMP/users.json")" PROFILE="$PROFILE" VUS="$VUS" \
  DURATION="$DURATION" SIFEN_RATE="$SIFEN_RATE" ACTIVE="$ACTIVE" LOAD="$LOAD" REPORT_DIR="$DIR" \
  k6 run --quiet --no-color --out "json=$DIR/raw.json.gz" "$REPO_ROOT/loadtest/scenarios/main.js"
K6_EXIT=$?
set -e
echo "$K6_EXIT" >"$DIR/exit_code"
date -u +%Y-%m-%dT%H:%M:%SZ >"$DIR/ended_at"

jq -n --arg ref "$REF" --arg bacpac "$BACPAC" --arg n "$N" --arg m "$M" \
  --arg run "local:$(hostname)" --arg started "$(cat "$DIR/started_at")" --arg ended "$(cat "$DIR/ended_at")" \
  --arg profile "$LABEL" --arg sifen "$SIFEN_RATE" \
  '{ref: $ref, bacpac: $bacpac, tenants: ($n|tonumber), sifen_tenants: ($m|tonumber), run_id: $run,
    profile: $profile, sifen_rate: ($sifen|tonumber), started_at: $started, ended_at: $ended}' >"$DIR/run.json"

az storage blob upload-batch --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" \
  -d "$REPORTS_CONTAINER" --destination-path "$PREFIX" -s "$DIR" --only-show-errors -o none
log "report stored privately at $REPORTS_CONTAINER/$PREFIX/ (local copy: $DIR)"
case "$K6_EXIT" in
  0) log "k6: all thresholds passed" ;;
  99) warn "k6: thresholds crossed (exit 99) — the finding, not a script failure" ;;
  *) warn "k6 exited $K6_EXIT" ;;
esac
echo "  Next: scripts/staging/collect-loadtest-metrics.sh --run=$PREFIX"
exit "$K6_EXIT"
