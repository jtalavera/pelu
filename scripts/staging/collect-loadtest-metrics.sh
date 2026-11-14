#!/usr/bin/env bash
# T7: collect the server-side side of a load-test report (docs/staging-env.md) for the window of a
# loadtest.yml run, while staging still exists, and store it next to the k6 report in the private
# loadtest-reports/ container.
#
#   scripts/staging/collect-loadtest-metrics.sh --run=<prefix printed by loadtest.yml>
#
# Writes .staging/loadtest/<prefix>/metrics.md: Container App CPU / working-set memory / replicas /
# restarts, SQL DTU % / storage, App Insights server-side request durations per endpoint (judge
# user-facing latency from these, not from k6: runners sit next to centralus), and replica starts.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

RUN=""
for arg in "$@"; do
  case "$arg" in
    --run=*) RUN="${arg#*=}" ;;
    *) die "usage: $0 --run=<prefix>" ;;
  esac
done
[[ -n "$RUN" ]] || die "usage: $0 --run=<prefix>"
require_cmd az jq terraform
ensure_subscription "$STAGING_SUBSCRIPTION_ID"

DIR="$WORK_DIR/loadtest/$RUN"
mkdir -p "$DIR"
blob_download "$REPORTS_CONTAINER" "$RUN/run.json" "$DIR/run.json"
blob_download "$REPORTS_CONTAINER" "$RUN/summary.txt" "$DIR/summary.txt" || warn "no k6 summary.txt in the report"
START="$(jq -r .started_at "$DIR/run.json")"
END="$(jq -r .ended_at "$DIR/run.json")"

APP_ID="$(az containerapp show -n "$CONTAINER_APP_NAME" -g "$STAGING_RG" --query id -o tsv)"
DB_ID="$(az sql db list -g "$STAGING_RG" --query "[?name=='$SQL_DB_NAME'].id | [0]" -o tsv)"
AI_APP="$(az resource list -g "$STAGING_RG" --resource-type microsoft.insights/components --query '[0].name' -o tsv)"

metric_table() { # metric_table <resource id> <metric> <aggregation> <label> <scale-expr>
  az monitor metrics list --resource "$1" --metrics "$2" --aggregation "$3" --interval PT1M \
    --start-time "$START" --end-time "$END" -o json \
    | jq -r --arg agg "$(tr '[:upper:]' '[:lower:]' <<<"$3")" --arg label "$4" --argjson scale "$5" '
        [.value[0].timeseries[0].data[]? | .[$agg] | select(. != null) | . * $scale] as $v
        | if ($v | length) == 0 then "| \($label) | — | — |"
          else "| \($label) | \(($v | add / length * 100 | round) / 100) | \(($v | max * 100 | round) / 100) |" end'
}

{
  echo "# Server-side metrics — $RUN"
  echo
  jq -r '"| | |\n|---|---|\n| Ref | `\(.ref)` |\n| Golden DB | `\(.bacpac)` (N = \(.tenants) tenants, M = \(.sifen_tenants) SIFEN) |\n| Window (UTC) | \(.started_at) → \(.ended_at) |\n| Workflow run | \(.run_id) |"' "$DIR/run.json"
  echo
  echo "## Container App and SQL (1-minute grain)"
  echo
  echo "| Metric | Avg | Max |"
  echo "|---|---|---|"
  metric_table "$APP_ID" UsageNanoCores Average "CPU (vCPU, of 0.5)" 0.000000001
  metric_table "$APP_ID" WorkingSetBytes Average "Working-set memory (MiB, of 1024)" 0.00000095367431640625
  metric_table "$APP_ID" Replicas Maximum "Replicas (max 1)" 1
  metric_table "$APP_ID" RestartCount Maximum "Restarts" 1
  metric_table "$DB_ID" dtu_consumption_percent Average "SQL DTU %" 1
  metric_table "$DB_ID" storage_percent Maximum "SQL storage % (of 2 GB)" 1
  echo
  echo "## Server-side request durations (App Insights)"
  echo
  echo "| Endpoint | Requests | p50 ms | p95 ms | p99 ms | Failed |"
  echo "|---|---|---|---|---|---|"
  az monitor app-insights query -g "$STAGING_RG" --app "$AI_APP" --start-time "$START" --end-time "$END" --analytics-query "
    requests
    | summarize n = count(), p50 = percentile(duration, 50), p95 = percentile(duration, 95), p99 = percentile(duration, 99),
                failed = countif(success == false) by name
    | top 25 by n desc" -o json \
    | jq -r '.tables[0].rows[] | "| \(.[0]) | \(.[1]) | \(.[2] | round) | \(.[3] | round) | \(.[4] | round) | \(.[5]) |"'
  echo
  echo "## Replica starts in the window (cold starts)"
  echo
  az monitor app-insights query -g "$STAGING_RG" --app "$AI_APP" --start-time "$START" --end-time "$END" --analytics-query "
    traces
    | where message has 'Started BackendApplication'
    | project timestamp, message" -o json \
    | jq -r '.tables[0].rows[] | "- \(.[0]): \(.[1] | .[0:160])"'
  echo
  echo "> Log Analytics is capped at 0.5 GB/day like prod: if it hit the cap during the run, the"
  echo "> sections above are incomplete for the rest of that day."
} >"$DIR/metrics.md"

blob_upload "$REPORTS_CONTAINER" "$RUN/metrics.md" "$DIR/metrics.md"
log "metrics written to $DIR/metrics.md and $REPORTS_CONTAINER/$RUN/metrics.md"
