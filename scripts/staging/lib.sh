# shellcheck shell=bash disable=SC2034
# (library: its variables are used by the scripts that source it)
# Shared helpers for scripts/staging/*.sh (docs/staging-env.md). Sourced, never executed.

STAGING_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$STAGING_DIR/../.." && pwd)"
INFRA_DIR="$REPO_ROOT/infrastructure_v2"
STAGING_TFVARS="$INFRA_DIR/environments/staging/terraform.tfvars"
STAGING_BACKEND="$INFRA_DIR/environments/staging/backend.hcl"
# Local, gitignored working dir: downloaded BACPACs, run reports, generated users file.
WORK_DIR="$REPO_ROOT/.staging"

# shellcheck source=staging.env
source "$STAGING_DIR/staging.env"

log() { printf '\033[1;34m[staging %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
warn() { printf '\033[1;33m[staging WARN]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[staging ERROR]\033[0m %s\n' "$*" >&2; exit 1; }

require_cmd() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing required tool: $c"; done
}

require_env() {
  local v
  for v in "$@"; do [[ -n "${!v:-}" ]] || die "environment variable $v must be set (never commit it)"; done
}

# go-sqlcmd (github.com/microsoft/go-sqlcmd) is required: it authenticates with the operator's
# `az login` (ActiveDirectoryDefault); SQL is Entra-only, there is no SQL login.
require_go_sqlcmd() {
  require_cmd sqlcmd
  # go-sqlcmd v1 lists the classic flags (incl. --authentication-method) under `sqlcmd -?`.
  # Capture first: `cmd | grep -q` fails under pipefail when grep exits early (SIGPIPE).
  local help
  help="$(sqlcmd -? 2>&1 || true)"
  [[ "$help" == *authentication-method* ]] \
    || die "sqlcmd must be go-sqlcmd (supports --authentication-method). Install: https://aka.ms/go-sqlcmd"
}

ensure_subscription() { # ensure_subscription <id>
  local current
  current="$(az account show --query id -o tsv 2>/dev/null)" || die "not logged in: run 'az login'"
  [[ "$current" == "$1" ]] || die "az is on subscription $current; run: az account set --subscription $1"
}

confirm() { # confirm "question" — skipped with ASSUME_YES=1
  [[ "${ASSUME_YES:-0}" == "1" ]] && return 0
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || die "aborted"
}

retry() { # retry <attempts> <sleep-seconds> <cmd...>
  local attempts="$1" pause="$2" i
  shift 2
  for ((i = 1; i <= attempts; i++)); do
    if "$@"; then return 0; fi
    ((i < attempts)) && { warn "attempt $i/$attempts failed: $*; retrying in ${pause}s"; sleep "$pause"; }
  done
  return 1
}

# ---------------------------------------------------------------------------------------------
# Terraform
# ---------------------------------------------------------------------------------------------

tf_staging_init() {
  require_cmd terraform
  log "terraform init (staging state: staging.tfstate)"
  terraform -chdir="$INFRA_DIR" init -reconfigure -input=false -backend-config="environments/staging/backend.hcl" >/dev/null
}

tf_out() { terraform -chdir="$INFRA_DIR" output -raw "$1"; }

# ---------------------------------------------------------------------------------------------
# SQL (go-sqlcmd, Entra auth via the az CLI login)
# ---------------------------------------------------------------------------------------------

sql_file() { # sql_file <server-fqdn> <db> <file> [VAR=value ...]
  local server="$1" db="$2" file="$3"
  shift 3
  local vars=() kv
  for kv in "$@"; do vars+=(-v "$kv"); done
  sqlcmd -S "tcp:${server},1433" -d "$db" --authentication-method ActiveDirectoryDefault \
    -b -I -i "$file" "${vars[@]}"
}

sql_query() { # sql_query <server-fqdn> <db> <query> — prints rows, no headers, tab-separated
  sqlcmd -S "tcp:${1},1433" -d "$2" --authentication-method ActiveDirectoryDefault \
    -b -I -h -1 -W -s $'\t' -Q "SET NOCOUNT ON; $3"
}

sql_access_token() { az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv; }

# Latest successfully applied Flyway version, e.g. "112".
flyway_version() { sql_query "$1" "$2" "SELECT TOP 1 version FROM flyway_schema_history WHERE success = 1 AND version IS NOT NULL ORDER BY installed_rank DESC" | tr -d '[:space:]'; }

# Highest V<n>__ migration in a git ref (what Flyway should reach after deploying that ref).
expected_flyway_version() { # expected_flyway_version <git ref>
  git -C "$REPO_ROOT" ls-tree --name-only "$1" src/backend/src/main/resources/db/migration/ \
    | sed -nE 's#.*/V([0-9]+)__.*#\1#p' | sort -n | tail -1
}

# ---------------------------------------------------------------------------------------------
# Persistent staging data storage (bootstrap.sh creates it; shared-key auth is disabled)
# ---------------------------------------------------------------------------------------------

blob_download() { # blob_download <container> <name> <file>
  az storage blob download --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" \
    --subscription "$STAGING_SUBSCRIPTION_ID" -c "$1" -n "$2" -f "$3" --overwrite --only-show-errors >/dev/null
}

blob_upload() { # blob_upload <container> <name> <file>
  az storage blob upload --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" \
    --subscription "$STAGING_SUBSCRIPTION_ID" -c "$1" -n "$2" -f "$3" --overwrite --only-show-errors >/dev/null
}

blob_exists() { # blob_exists <container> <name>
  [[ "$(az storage blob exists --auth-mode login --account-name "$STAGING_DATA_ACCOUNT" \
    --subscription "$STAGING_SUBSCRIPTION_ID" -c "$1" -n "$2" --query exists -o tsv 2>/dev/null)" == "true" ]]
}

# ---------------------------------------------------------------------------------------------
# Misc
# ---------------------------------------------------------------------------------------------

# BCrypt hash ($2a/$2b/$2y — Spring's BCryptPasswordEncoder accepts all three) of $1.
bcrypt_hash() {
  local pw="$1"
  if python3 -c 'import bcrypt' 2>/dev/null; then
    PW="$pw" python3 -c 'import bcrypt,os;print(bcrypt.hashpw(os.environ["PW"].encode(),bcrypt.gensalt(10)).decode())'
  elif command -v htpasswd >/dev/null 2>&1; then
    htpasswd -nbBC 10 "" "$pw" | tr -d ':\n'
  else
    die "need a BCrypt helper: pip install bcrypt, or apt install apache2-utils (htpasswd)"
  fi
}

my_public_ip() { curl -fsS --max-time 10 https://api.ipify.org; }

http_status() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
