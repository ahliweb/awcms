#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[runtime-ci] admin lint"
npm run lint --prefix "$REPO_ROOT/awcms"

echo "[runtime-ci] admin build"
npm run build --prefix "$REPO_ROOT/awcms"

echo "[runtime-ci] admin client storage guard"
npm test --prefix "$REPO_ROOT/awcms" -- --run src/lib/customSupabaseClient.test.js

echo "[runtime-ci] shared storage guard"
npm run test:storage-guard --prefix "$REPO_ROOT/packages/awcms-shared"

echo "[runtime-ci] edge typecheck"
npm run typecheck --prefix "$REPO_ROOT/awcms-edge"

echo "[runtime-ci] migration parity"
bash "$REPO_ROOT/scripts/verify_supabase_migration_consistency.sh"

echo "[runtime-ci] complete"
