#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

extract_env_value() {
  local file_path="$1"
  local key_name="$2"

  [[ -f "$file_path" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    local raw="$line"
    raw="${raw#export }"

    if [[ "$raw" == "$key_name="* ]]; then
      local value="${raw#*=}"
      value="${value%%#*}"
      value="${value%$'\r'}"
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      printf '%s' "$value"
      return 0
    fi
  done < "$file_path"

  return 1
}

load_token_from_env_files() {
  local files=(
    "$REPO_ROOT/awcms/.env.local"
    "$REPO_ROOT/awcms/.env"
    "$REPO_ROOT/.env.local"
    "$REPO_ROOT/.env"
  )

  local keys=(
    "GITHUB_PERSONAL_ACCESS_TOKEN"
    "GITHUB_MCP_PERSONAL_ACCESS_TOKEN"
    "GH_TOKEN"
    "GITHUB_TOKEN"
  )

  local file_path
  local key_name
  local value

  for file_path in "${files[@]}"; do
    for key_name in "${keys[@]}"; do
      if value="$(extract_env_value "$file_path" "$key_name")" && [[ -n "$value" ]]; then
        printf '%s' "$value"
        return 0
      fi
    done
  done

  return 1
}

if [[ -n "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  token="${GITHUB_PERSONAL_ACCESS_TOKEN}"
elif [[ -n "${GITHUB_MCP_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  token="${GITHUB_MCP_PERSONAL_ACCESS_TOKEN}"
elif [[ -n "${GH_TOKEN:-}" ]]; then
  token="${GH_TOKEN}"
elif [[ -n "${GITHUB_TOKEN:-}" ]]; then
  token="${GITHUB_TOKEN}"
elif token="$(load_token_from_env_files)" && [[ -n "$token" ]]; then
  :
else
  echo "GitHub MCP requires a token. Set one of: GITHUB_PERSONAL_ACCESS_TOKEN, GITHUB_MCP_PERSONAL_ACCESS_TOKEN, GH_TOKEN, or GITHUB_TOKEN." >&2
  exit 1
fi

export GITHUB_PERSONAL_ACCESS_TOKEN="${token}"

exec docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server stdio "$@"
