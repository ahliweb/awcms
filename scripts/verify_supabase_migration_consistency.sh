#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
MIRROR_MIGRATIONS_DIR="$REPO_ROOT/awcms/supabase/migrations"

CHECK_LINKED=false

derive_db_password_from_urls() {
  python3 - <<'PY'
import os
from urllib.parse import urlparse

for key in ("DATABASE_URL", "DATABASE_ADMIN_URL"):
    url = os.environ.get(key, "")
    if not url:
        continue
    parsed = urlparse(url)
    if parsed.password:
        print(parsed.password)
        break
PY
}

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
  load_env_file "$REPO_ROOT/awcms/.env.remote"
  load_env_file "$REPO_ROOT/.env.remote"
  load_env_file "$REPO_ROOT/awcms/.env"
  load_env_file "$REPO_ROOT/awcms/.env.local"
  load_env_file "$REPO_ROOT/.env"
  load_env_file "$REPO_ROOT/.env.local"
}

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME [options]

Validate Supabase migration consistency across:
1) root and mirrored migration directories, and
2) migration history table for local/linked scopes.

Options:
  --linked      Also validate linked remote migration history
  -h, --help    Show this help

Examples:
  $SCRIPT_NAME
  $SCRIPT_NAME --linked
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --linked)
      CHECK_LINKED=true
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

if [ ! -d "$ROOT_MIGRATIONS_DIR" ]; then
  echo "Error: root migrations directory not found: $ROOT_MIGRATIONS_DIR"
  exit 1
fi

if [ ! -d "$MIRROR_MIGRATIONS_DIR" ]; then
  echo "Error: mirror migrations directory not found: $MIRROR_MIGRATIONS_DIR"
  exit 1
fi

echo "Checking migration directory parity..."
python3 - "$ROOT_MIGRATIONS_DIR" "$MIRROR_MIGRATIONS_DIR" <<'PY'
from pathlib import Path
import hashlib
import sys

root = Path(sys.argv[1])
mirror = Path(sys.argv[2])

def file_map(base: Path):
    return {p.name: p for p in base.glob("*.sql")}

root_map = file_map(root)
mirror_map = file_map(mirror)

missing_in_mirror = sorted(set(root_map) - set(mirror_map))
extra_in_mirror = sorted(set(mirror_map) - set(root_map))

if missing_in_mirror:
    print("Mismatch: files missing in mirror directory:")
    for name in missing_in_mirror:
        print(f"  - {name}")

if extra_in_mirror:
    print("Mismatch: extra files present in mirror directory:")
    for name in extra_in_mirror:
        print(f"  - {name}")

content_mismatch = []
for name in sorted(set(root_map) & set(mirror_map)):
    h1 = hashlib.sha256(root_map[name].read_bytes()).hexdigest()
    h2 = hashlib.sha256(mirror_map[name].read_bytes()).hexdigest()
    if h1 != h2:
        content_mismatch.append(name)

if content_mismatch:
    print("Mismatch: file content differs between root and mirror:")
    for name in content_mismatch:
        print(f"  - {name}")

if missing_in_mirror or extra_in_mirror or content_mismatch:
    sys.exit(1)

print(f"OK: {len(root_map)} migration files mirrored with matching content.")
PY

check_scope() {
  local scope="$1"
  local output

  echo "Checking migration history scope: $scope"

  if ! output="$(npx supabase migration list --"$scope" 2>&1)"; then
    echo "$output"
    echo "Failed: could not list migrations for scope '$scope'."
    exit 1
  fi

  MIGRATION_LIST_OUTPUT="$output" python3 - "$scope" <<'PY'
import os
import re
import sys

scope = sys.argv[1]
text = os.environ.get("MIGRATION_LIST_OUTPUT", "")

row_pattern = re.compile(r"^\s*([0-9]{14})?\s*\|\s*([0-9]{14})?\s*\|")
rows = []

for line in text.splitlines():
    m = row_pattern.match(line)
    if not m:
        continue
    local_v = (m.group(1) or "").strip()
    remote_v = (m.group(2) or "").strip()
    rows.append((local_v, remote_v, line))

if not rows:
    print(f"Failed: no migration rows parsed for scope '{scope}'.")
    print(text)
    sys.exit(1)

mismatches = [row for row in rows if not row[0] or not row[1] or row[0] != row[1]]
if mismatches:
    print(f"Mismatch detected in migration scope '{scope}':")
    for _, _, raw in mismatches:
        print(raw)
    sys.exit(1)

print(f"OK: {len(rows)} migrations aligned for scope '{scope}'.")
PY
}

check_scope local

if [ "$CHECK_LINKED" = true ]; then
  load_linked_env_defaults

  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
    echo "Error: --linked requires SUPABASE_ACCESS_TOKEN in a loaded env file or shell environment."
    exit 1
  fi

  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    SUPABASE_DB_PASSWORD="$(derive_db_password_from_urls)"
    if [ -n "$SUPABASE_DB_PASSWORD" ]; then
      export SUPABASE_DB_PASSWORD
    fi
  fi

  if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
    echo "Error: --linked requires SUPABASE_DB_PASSWORD in a loaded env file, shell environment, or derivable DATABASE_URL/DATABASE_ADMIN_URL."
    exit 1
  fi

  check_scope linked
fi

echo "All migration consistency checks passed."
