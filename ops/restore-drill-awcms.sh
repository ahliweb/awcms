#!/usr/bin/env bash
# Weekly AWCMS restore drill — actually restore the newest backup, into a
# throwaway database, and count what came back.
#
# WHY A DRILL AND NOT JUST A VERIFIED BACKUP
#
# `backup-awcms.sh` proves the archive PARSES. That is a real check and it is not
# the same claim as "this can be restored". The difference has bitten this host
# already: a `pg_restore` invocation that silently restored NOTHING looked
# successful because the command was written `pg_restore --no-owner=false`
# (an invalid flag), the failure was swallowed by `|| true`, and a grep for
# "0 errors" in the output confirmed the happy story. Two guards, both green,
# neither of which had looked at a restored row.
#
# So this restores for real and then asks the restored database questions:
#
#   - does the migration ledger contain the migrations we expect?
#   - do the core tables exist and hold rows?
#
# and it drops the throwaway database whether it passed or failed.
#
# WHY THE ROLES ARE CREATED FIRST
#
# A dump carries GRANTs to `awcms_app`, `awcms_worker`, `awcms_setup` and
# `awcms_domain_bootstrap`. Restoring into a database whose cluster lacks those
# roles produces a wall of errors that are easy to wave away as "just
# permissions" — and hides real ones. On this host the roles exist in the same
# cluster, so the drill restores into a NEW DATABASE in that cluster rather than
# a new cluster, and the roles are already there.
#
# Install:
#   scp ops/restore-drill-awcms.sh dinkes-prod:/home/admin1/awcms-jobs/ && chmod +x
#   crontab:  0 18 * * 6 /usr/bin/flock -n … restore-drill-awcms.sh >> …/restore-drill.log 2>&1
set -euo pipefail

DEST="${AWCMS_BACKUP_DEST:-/home/admin1/backups/awcms}"
PG_FILTER="${AWCMS_PG_FILTER:-my85c1xd4txesedhic72maeu}"
DB_USER="${AWCMS_DB_USER:-awcms_staging}"
DRILL_DB="${AWCMS_DRILL_DB:-awcms_restore_drill}"
# Below this the restore did not really happen, whatever pg_restore said.
MIN_TABLES="${AWCMS_MIN_TABLES:-80}"

log() { echo "$(date -Is) restore-drill: $*"; }
die() { echo "$(date -Is) restore-drill ERROR: $*" >&2; exit 1; }

PG=$(docker ps --filter "name=${PG_FILTER}" --format '{{.Names}}' | head -1)
[ -n "$PG" ] || die "postgres container matching '${PG_FILTER}' is not running"

NEWEST=$(find "$DEST" -maxdepth 1 -name 'awcms-*.dump' -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)
[ -n "$NEWEST" ] || die "no backup found in ${DEST}"
log "drilling ${NEWEST}"

cleanup() {
  docker exec "$PG" psql -q -U "$DB_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${DRILL_DB} WITH (FORCE);" >/dev/null 2>&1 || true
  docker exec "$PG" rm -f /tmp/drill.dump >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup
docker exec "$PG" psql -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE ${DRILL_DB};"

docker cp "$NEWEST" "${PG}:/tmp/drill.dump"

# NOT `|| true`. A failing restore must fail the drill — that is the whole point.
# `--no-owner` is deliberate and spelled correctly: the drill DB is owned by the
# restoring role, and reassigning ownership is not what is under test.
log "restoring…"
docker exec "$PG" pg_restore --no-owner --exit-on-error -U "$DB_USER" -d "$DRILL_DB" /tmp/drill.dump

TABLES=$(docker exec "$PG" psql -tAX -U "$DB_USER" -d "$DRILL_DB" \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
[ "${TABLES:-0}" -ge "$MIN_TABLES" ] \
  || die "restored database has ${TABLES} tables, expected at least ${MIN_TABLES}"

MIGRATIONS=$(docker exec "$PG" psql -tAX -U "$DB_USER" -d "$DRILL_DB" \
  -c "SELECT count(*) FROM awcms_schema_migrations;")
[ "${MIGRATIONS:-0}" -gt 0 ] || die "restored database has an empty migration ledger"

# Ask for actual ROWS, not just tables. A schema-only restore passes every check
# above and is not a backup of anything.
TENANTS=$(docker exec "$PG" psql -tAX -U "$DB_USER" -d "$DRILL_DB" \
  -c "SELECT count(*) FROM awcms_tenants;")
[ "${TENANTS:-0}" -gt 0 ] || die "restored database has zero tenants — data did not come back"

log "OK — ${TABLES} tables, ${MIGRATIONS} migrations, ${TENANTS} tenant(s) restored from $(basename "$NEWEST")"
