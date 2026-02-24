#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"

DEFAULT_REVERTED=(
  "20260223094459"
  "20260223095101"
  "20260223101537"
)

REVERTED_VERSIONS=("${DEFAULT_REVERTED[@]}")
APPLY=false
YES=false
REPAIR_SCOPE="linked"

load_env_file() {
  local file_path="$1"
  [ -f "$file_path" ] || return 0

  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    local line="$raw_line"
    line="${line#export }"

    case "$line" in
      ''|\#*)
        continue
        ;;
    esac

    if [[ "$line" != *"="* ]]; then
      continue
    fi

    local key="${line%%=*}"
    local value="${line#*=}"

    key="${key## }"
    key="${key%% }"
    value="${value%$'\r'}"
    value="${value%\#*}"
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"

    if [ -z "$key" ]; then
      continue
    fi

    if [ -n "${!key:-}" ]; then
      continue
    fi

    export "$key=$value"
  done < "$file_path"
}

load_linked_env_defaults() {
  load_env_file "$REPO_ROOT/awcms/.env"
  load_env_file "$REPO_ROOT/awcms/.env.local"
  load_env_file "$REPO_ROOT/awcms/.env.remote"
  load_env_file "$REPO_ROOT/.env"
  load_env_file "$REPO_ROOT/.env.local"
  load_env_file "$REPO_ROOT/.env.remote"
}

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [options]

Generate (default) or run Supabase migration repair commands using local
migration files as source of truth.

Options:
  --apply                  Execute repair commands (default is dry-run)
  --yes                    Skip confirmation prompt (only with --apply)
  --local                  Target local database migration history
  --linked                 Target linked remote database migration history (default)
  --no-default-reverted    Do not include built-in reverted versions
  --reverted <timestamp>   Add a reverted version (can be repeated)
  -h, --help               Show this help

Examples:
  $SCRIPT_NAME
  $SCRIPT_NAME --local
  $SCRIPT_NAME --no-default-reverted --reverted 20260224123456
  $SCRIPT_NAME --apply
  $SCRIPT_NAME --apply --local
  $SCRIPT_NAME --apply --yes --no-default-reverted --reverted 20260224123456
EOF
}

is_timestamp() {
  [[ "$1" =~ ^[0-9]{14}$ ]]
}

dedupe_and_sort() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  printf '%s\n' "$@" | sort -u
}

print_command() {
  local status="$1"
  local version="$2"
  printf 'npx supabase migration repair --%s --status %s %s\n' "$REPAIR_SCOPE" "$status" "$version"
}

execute_command() {
  local status="$1"
  local version="$2"
  printf '+ %s\n' "$(print_command "$status" "$version")"
  npx supabase migration repair "--$REPAIR_SCOPE" --status "$status" "$version"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true
      ;;
    --yes)
      YES=true
      ;;
    --local)
      REPAIR_SCOPE="local"
      ;;
    --linked)
      REPAIR_SCOPE="linked"
      ;;
    --no-default-reverted)
      REVERTED_VERSIONS=()
      ;;
    --reverted)
      if [ "$#" -lt 2 ]; then
        echo "Error: --reverted requires a timestamp argument"
        usage
        exit 1
      fi
      if ! is_timestamp "$2"; then
        echo "Error: invalid timestamp '$2' (expected 14 digits)"
        exit 1
      fi
      REVERTED_VERSIONS+=("$2")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'"
      usage
      exit 1
      ;;
  esac
  shift
done

if [ "$REPAIR_SCOPE" = "linked" ]; then
  load_linked_env_defaults
fi

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "Error: migrations directory not found: $MIGRATIONS_DIR"
  exit 1
fi

local_versions=()
invalid_files=()

for file in "$MIGRATIONS_DIR"/*.sql; do
  [ -e "$file" ] || continue
  base_name="$(basename "$file")"

  if [[ "$base_name" =~ ^([0-9]{14})_.+\.sql$ ]]; then
    local_versions+=("${BASH_REMATCH[1]}")
  else
    invalid_files+=("$base_name")
  fi
done

if [ "${#local_versions[@]}" -eq 0 ]; then
  echo "Error: no valid timestamped migration files found in $MIGRATIONS_DIR"
  exit 1
fi

mapfile -t sorted_local_versions < <(dedupe_and_sort "${local_versions[@]}")

if [ "${#REVERTED_VERSIONS[@]}" -gt 0 ]; then
  mapfile -t sorted_reverted_versions < <(dedupe_and_sort "${REVERTED_VERSIONS[@]}")
else
  sorted_reverted_versions=()
fi

echo "Supabase migration history repair plan"
echo "- Repo root: $REPO_ROOT"
echo "- Repair scope: $REPAIR_SCOPE"
echo "- Valid local migrations: ${#sorted_local_versions[@]}"
echo "- Reverted versions: ${#sorted_reverted_versions[@]}"

if [ "${#invalid_files[@]}" -gt 0 ]; then
  echo
  echo "Warning: invalid migration file names detected (ignored by this script):"
  for file in "${invalid_files[@]}"; do
    echo "  - $file"
  done
  echo "Rename or move invalid files before running 'supabase db pull'."
fi

echo
echo "Commands:"

for version in "${sorted_reverted_versions[@]}"; do
  print_command "reverted" "$version"
done

for version in "${sorted_local_versions[@]}"; do
  print_command "applied" "$version"
done

if [ "$APPLY" = false ]; then
  echo
  echo "Dry run only. Re-run with --apply to execute."
  exit 0
fi

if [ "$YES" = false ]; then
  echo
  read -r -p "Apply all commands above? [y/N]: " confirm
  case "$confirm" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

echo
echo "Executing migration repairs..."

for version in "${sorted_reverted_versions[@]}"; do
  execute_command "reverted" "$version"
done

for version in "${sorted_local_versions[@]}"; do
  execute_command "applied" "$version"
done

echo
echo "Done. Recommended verification:"
echo "  npx supabase migration list --$REPAIR_SCOPE"
if [ "$REPAIR_SCOPE" = "local" ]; then
  echo "  npx supabase db push --local"
else
  echo "  npx supabase db pull"
fi
echo "  scripts/verify_supabase_migration_consistency.sh"
