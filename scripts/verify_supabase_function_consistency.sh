#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_FUNCTIONS_DIR="$REPO_ROOT/supabase/functions"
MIRROR_FUNCTIONS_DIR="$REPO_ROOT/awcms/supabase/functions"
EXAMPLE_ONLY_REMOTE_SLUGS=("content-transform")

CHECK_LINKED=false
PROJECT_REF="${SUPABASE_PROJECT_REF:-}"

run_remote_functions_list() {
  npx supabase functions list --project-ref "$PROJECT_REF" -o json 2>&1
}

derive_project_ref_from_url() {
  local url="${SUPABASE_URL:-}"
  if [ -z "$url" ]; then
    return 0
  fi

  python3 - <<'PY'
import os
from urllib.parse import urlparse

url = os.environ.get("SUPABASE_URL", "")
if not url:
    raise SystemExit(0)

host = urlparse(url).hostname or ""
parts = host.split(".")
if len(parts) >= 3 and parts[-2:] == ["supabase", "co"] and parts[0]:
    print(parts[0])
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

Validate Supabase Edge Function consistency across root and mirrored directories.
Optional linked check verifies all local function slugs exist in remote project.

Options:
  --linked                 Also validate remote function slugs
  --project-ref <ref>      Supabase project ref for linked checks
  -h, --help               Show this help

Examples:
  $SCRIPT_NAME
  $SCRIPT_NAME --linked --project-ref your-project-ref
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --linked)
      CHECK_LINKED=true
      ;;
    --project-ref)
      if [ "$#" -lt 2 ]; then
        echo "Error: --project-ref requires a value"
        usage
        exit 1
      fi
      PROJECT_REF="$2"
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

if [ ! -d "$ROOT_FUNCTIONS_DIR" ]; then
  echo "Error: root functions directory not found: $ROOT_FUNCTIONS_DIR"
  exit 1
fi

if [ ! -d "$MIRROR_FUNCTIONS_DIR" ]; then
  echo "Error: mirror functions directory not found: $MIRROR_FUNCTIONS_DIR"
  exit 1
fi

echo "Checking function directory parity..."
python3 - "$ROOT_FUNCTIONS_DIR" "$MIRROR_FUNCTIONS_DIR" <<'PY'
from pathlib import Path
import hashlib
import sys

root = Path(sys.argv[1])
mirror = Path(sys.argv[2])

ignored_files = {".env"}

root_files = {
    p.relative_to(root).as_posix(): p
    for p in root.rglob("*")
    if p.is_file() and p.relative_to(root).as_posix() not in ignored_files
}
mirror_files = {
    p.relative_to(mirror).as_posix(): p
    for p in mirror.rglob("*")
    if p.is_file() and p.relative_to(mirror).as_posix() not in ignored_files
}

root_only = sorted(set(root_files) - set(mirror_files))
mirror_only = sorted(set(mirror_files) - set(root_files))

if root_only:
    print("Mismatch: files only in root functions directory:")
    for rel in root_only:
        print(f"  - {rel}")

if mirror_only:
    print("Mismatch: files only in mirror functions directory:")
    for rel in mirror_only:
        print(f"  - {rel}")

content_mismatch = []
for rel in sorted(set(root_files) & set(mirror_files)):
    h1 = hashlib.sha256(root_files[rel].read_bytes()).hexdigest()
    h2 = hashlib.sha256(mirror_files[rel].read_bytes()).hexdigest()
    if h1 != h2:
        content_mismatch.append(rel)

if content_mismatch:
    print("Mismatch: file content differs between root and mirror:")
    for rel in content_mismatch:
        print(f"  - {rel}")

if root_only or mirror_only or content_mismatch:
    sys.exit(1)

local_slugs = sorted([
    p.name for p in root.iterdir()
    if p.is_dir() and p.name != "_shared"
])

if not local_slugs:
    print("Failed: no local function directories found.")
    sys.exit(1)

for slug in local_slugs:
    index_file = root / slug / "index.ts"
    if not index_file.exists():
        print(f"Missing function entrypoint: {index_file}")
        sys.exit(1)

print(f"OK: {len(local_slugs)} local function slugs mirrored with matching content.")
PY

if [ "$CHECK_LINKED" = true ]; then
  load_linked_env_defaults

  if [ -z "$PROJECT_REF" ]; then
    PROJECT_REF="$(derive_project_ref_from_url)"
  fi

  if [ -z "$PROJECT_REF" ]; then
    echo "Error: --linked requires --project-ref, SUPABASE_PROJECT_REF, or a derivable SUPABASE_URL."
    exit 1
  fi

  echo "Checking remote function slugs for project: $PROJECT_REF"

  remote_output="$(run_remote_functions_list || true)"

  if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [[ "$remote_output" == *'unexpected list functions status 401'* ]]; then
    echo "Linked function check received 401 with SUPABASE_ACCESS_TOKEN; retrying with local Supabase CLI profile..."
    remote_output="$(env -u SUPABASE_ACCESS_TOKEN bash -lc '
      set -euo pipefail
      PROJECT_REF="$1"
      npx supabase functions list --project-ref "$PROJECT_REF" -o json 2>&1
    ' bash "$PROJECT_REF" || true)"
  fi

  if [ -z "$remote_output" ]; then
    echo "Failed: could not list remote functions."
    exit 1
  fi

  if ! REMOTE_OUTPUT_VALIDATE="$remote_output" python3 - <<'PY'
import json
import os
import sys

try:
    json.loads(os.environ["REMOTE_OUTPUT_VALIDATE"])
except Exception:
    raise SystemExit(1)
PY
  then
    echo "$remote_output"
    echo "Failed: could not list remote functions. Verify SUPABASE_ACCESS_TOKEN and project access."
    exit 1
  fi

  ROOT_FUNCTIONS_DIR="$ROOT_FUNCTIONS_DIR" REMOTE_JSON="$remote_output" EXAMPLE_ONLY_REMOTE_SLUGS="${EXAMPLE_ONLY_REMOTE_SLUGS[*]}" python3 - <<'PY'
from pathlib import Path
import json
import os
import sys

root = Path(os.environ["ROOT_FUNCTIONS_DIR"])
remote_json = os.environ["REMOTE_JSON"]
ignored = {slug for slug in os.environ.get("EXAMPLE_ONLY_REMOTE_SLUGS", "").split() if slug}

try:
    remote = json.loads(remote_json)
except json.JSONDecodeError:
    print("Failed: invalid JSON from `supabase functions list`.")
    print(remote_json)
    sys.exit(1)

remote_slugs = sorted({item.get("slug") for item in remote if item.get("slug")})
local_slugs = sorted([
    p.name for p in root.iterdir()
    if p.is_dir() and p.name != "_shared" and p.name not in ignored
])

missing_remote = sorted(set(local_slugs) - set(remote_slugs))
if missing_remote:
    print("Missing remote functions for local slugs:")
    for slug in missing_remote:
        print(f"  - {slug}")
    sys.exit(1)

print(f"OK: remote contains all {len(local_slugs)} local function slugs.")
PY
fi

echo "All function consistency checks passed."
