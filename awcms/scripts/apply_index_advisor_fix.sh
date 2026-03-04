#!/usr/bin/env bash

set -euo pipefail

MIGRATION_PATH="$(cd "$(dirname "$0")/../.." && pwd)/supabase/migrations/20260207123000_fix_index_advisor_text_array_init.sql"

if [ ! -f "$MIGRATION_PATH" ]; then
  echo "Migration not found: $MIGRATION_PATH"
  exit 1
fi

CONTAINER_NAME="supabase_db_awcms-dev"

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "Supabase DB container not running: $CONTAINER_NAME"
  echo "Start it with: npx supabase start"
  exit 1
fi

# Read password from environment or .env file, fallback to default local dev password
PGPASSWORD="${SUPABASE_DB_PASSWORD:-${POSTGRES_PASSWORD:-postgres}}"

echo "Applying index_advisor patch as supabase_admin..."
docker exec -e PGPASSWORD="$PGPASSWORD" -i "$CONTAINER_NAME" psql -U supabase_admin -d postgres < "$MIGRATION_PATH"
echo "Done."
