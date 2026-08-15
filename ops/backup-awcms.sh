#!/usr/bin/env bash
# Nightly AWCMS database backup.
#
# WHY THIS EXISTS
#
# `scheduled_database_backups` in Coolify was EMPTY. Every backup this database
# had was taken by hand, immediately before a migration, by whoever happened to
# be doing the migration. That is not a backup policy; it is a habit, and habits
# do not survive the day nobody is watching.
#
# WHY IT VERIFIES, AND WHY THAT IS NOT PARANOIA
#
# A backup that has never been read is a guess. This host has already produced a
# convincing-looking dump that was not one: a `scp` piped into `| tail` returned
# the exit code of `tail`, a `timeout` killed the transfer part-way, and a
# TRUNCATED 4.9 MB file was reported as a successful backup. It was caught by
# comparing size and checksum, not by anything the backup itself said.
#
# So every dump is checked here, immediately, in two ways that a truncated or
# corrupt file cannot both pass:
#
#   1. `pg_restore -l` must parse the archive and list its table of contents.
#      A truncated custom-format dump fails this outright.
#   2. The object count must be within sight of the previous backup's. A dump
#      that parses but lost half the schema is the failure mode that a bare
#      "did it parse?" check misses.
#
# The exit code is the verdict. Nothing here is piped into `head`/`tail` for
# exactly the reason above — in a pipeline, `$?` is the LAST command's.
#
# Install:
#   scp ops/backup-awcms.sh dinkes-prod:/home/admin1/awcms-jobs/ && chmod +x
#   crontab:  30 17 * * * /usr/bin/flock -n … backup-awcms.sh >> …/backup.log 2>&1
# 17:30 UTC = 00:30 WIB — before the retention jobs at 03:00-04:00 UTC, so the
# night's backup is always taken BEFORE anything deletes for retention.
set -euo pipefail

DEST="${AWCMS_BACKUP_DEST:-/home/admin1/backups/awcms}"
KEEP="${KEEP:-14}"
DB="${AWCMS_DB:-awcms}"
DB_USER="${AWCMS_DB_USER:-awcms_staging}"
PG_FILTER="${AWCMS_PG_FILTER:-my85c1xd4txesedhic72maeu}"
# A dump this small means something went wrong, whatever the exit codes said.
MIN_BYTES="${AWCMS_MIN_BYTES:-1000000}"
# Fail if the object count drops by more than this fraction versus the last good
# backup. A real schema change moves it by a few objects; losing a tenth of the
# catalogue is a broken dump wearing a valid header.
MAX_SHRINK_PCT="${AWCMS_MAX_SHRINK_PCT:-10}"

log() { echo "$(date -Is) backup-awcms: $*"; }
die() { echo "$(date -Is) backup-awcms ERROR: $*" >&2; exit 1; }

PG=$(docker ps --filter "name=${PG_FILTER}" --format '{{.Names}}' | head -1)
[ -n "$PG" ] || die "postgres container matching '${PG_FILTER}' is not running — no backup taken"

mkdir -p "$DEST"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="awcms-${TS}.dump"
TMP="${DEST}/.${NAME}.partial"

# -Fc: custom format, so `pg_restore -l` can verify it and a selective restore is
# possible. Written to a .partial name first so an interrupted run can never be
# mistaken for a finished backup by the retention sweep below.
log "dumping ${DB} from ${PG}"
docker exec "$PG" pg_dump -Fc -U "$DB_USER" -d "$DB" > "$TMP"

SIZE=$(stat -c %s "$TMP")
[ "$SIZE" -ge "$MIN_BYTES" ] || die "dump is ${SIZE} bytes, below the ${MIN_BYTES} floor — treating as truncated"

# VERIFY 1 — does it parse at all?
#
# The archive is copied INTO the postgres container and read from a real path.
# It is not piped in on stdin: a custom-format dump is a seekable archive, and
# `pg_restore -l /dev/stdin` fails with
#
#   pg_restore: error: did not find magic string in file header
#
# on a perfectly good dump. That message names the archive, so it reads as
# "your backup is corrupt" when it means "you handed me a pipe" — and this exact
# mistake has already been made on this host once, on a dump that turned out to
# be fine. Failing a good backup is not a safe error: it trains whoever is on
# call to disbelieve the check.
docker cp "$TMP" "${PG}:/tmp/verify.dump" >/dev/null
TOC=$(docker exec "$PG" pg_restore -l /tmp/verify.dump) || {
  docker exec "$PG" rm -f /tmp/verify.dump >/dev/null 2>&1 || true
  die "pg_restore -l could not read the archive"
}
docker exec "$PG" rm -f /tmp/verify.dump >/dev/null 2>&1 || true
OBJECTS=$(printf '%s\n' "$TOC" | grep -c '^[0-9]' || true)
[ "${OBJECTS:-0}" -gt 0 ] || die "pg_restore -l listed no objects — archive is unreadable"

# VERIFY 2 — is it the same shape as last night's?
LAST_COUNT_FILE="${DEST}/.last-object-count"
if [ -f "$LAST_COUNT_FILE" ]; then
  PREV=$(cat "$LAST_COUNT_FILE")
  if [ "$PREV" -gt 0 ]; then
    FLOOR=$(( PREV - (PREV * MAX_SHRINK_PCT / 100) ))
    [ "$OBJECTS" -ge "$FLOOR" ] \
      || die "object count fell from ${PREV} to ${OBJECTS} (floor ${FLOOR}) — refusing to record this as a good backup"
  fi
fi

mv "$TMP" "${DEST}/${NAME}"
chmod 600 "${DEST}/${NAME}"
echo "$OBJECTS" > "$LAST_COUNT_FILE"

log "OK ${NAME} — ${SIZE} bytes, ${OBJECTS} objects"

# Owner-only across the whole retained set, not just the new file.
find "$DEST" -maxdepth 1 -name 'awcms-*.dump' -exec chmod 600 {} +

# Retention: keep the newest $KEEP.
find "$DEST" -maxdepth 1 -name 'awcms-*.dump' -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | xargs -r rm -f

# Any leftover .partial older than a day is a crashed run, not work in progress.
find "$DEST" -maxdepth 1 -name '.awcms-*.partial' -mtime +1 -delete
