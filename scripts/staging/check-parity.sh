#!/usr/bin/env bash
# T2 (docs/staging-env.md): fail if staging tfvars drift from prod on anything that affects
# performance, cost or scale. Runs in CI (.github/workflows/staging-parity.yml) and in up.sh.
#   scripts/staging/check-parity.sh          # tfvars vs tfvars (+ variable defaults)
#   scripts/staging/check-parity.sh --live   # also compare with the LIVE prod resources (needs az
#                                            # login with read access to the prod subscription)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 "$HERE/parity.py" check
if [[ "${1:-}" == "--live" ]]; then
  python3 "$HERE/parity.py" live
fi
