#!/usr/bin/env zsh
set -euo pipefail

# Required auth env vars for local backend runtime.
GOOGLE_CLIENT_ID_VALUE="1078319977684-o2gv354db0phi2h6l3390e5m6q1h9gss.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET_VALUE="${GOOGLE_CLIENT_SECRET:-}"

if [[ -z "${GOOGLE_CLIENT_SECRET_VALUE}" ]]; then
  echo "ERROR: GOOGLE_CLIENT_SECRET is empty."
  echo "Run like:"
  echo "  GOOGLE_CLIENT_SECRET='your-secret' ./src/backend/scripts/set-auth-env.zsh"
  exit 1
fi

append_or_replace_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped=$(printf '%s' "${value}" | sed 's/[\/&]/\\&/g')

  if [[ -f "${file}" ]] && grep -q "^export ${key}=" "${file}"; then
    sed -i '' "s/^export ${key}=.*/export ${key}=\"${escaped}\"/" "${file}"
  else
    {
      echo ""
      echo "# Added by src/backend/scripts/set-auth-env.zsh"
      echo "export ${key}=\"${value}\""
    } >> "${file}"
  fi
}

ZSH_PROFILE="${HOME}/.zshrc"

append_or_replace_env "${ZSH_PROFILE}" "GOOGLE_CLIENT_ID" "${GOOGLE_CLIENT_ID_VALUE}"
append_or_replace_env "${ZSH_PROFILE}" "GOOGLE_CLIENT_SECRET" "${GOOGLE_CLIENT_SECRET_VALUE}"

# Also export for current shell/session.
export GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID_VALUE}"
export GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET_VALUE}"

echo "Done. Updated ${ZSH_PROFILE} and exported current-session vars:"
echo "  GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}"
echo "  GOOGLE_CLIENT_SECRET=***hidden***"
echo ""
echo "Apply in new terminals automatically, or run now:"
echo "  source ${ZSH_PROFILE}"
