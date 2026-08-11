#!/usr/bin/env bash
#
# backup-postgres.sh — take a PostgreSQL backup of an AWCMS database and prove,
# before exiting 0, that the file it just wrote is readable.
#
# Referenced as a required step by docs/awcms/deploy-coolify.md §Backup,
# docs/awcms/07_sprint_testing_production_readiness.md §Backup SOP ringkas,
# docs/awcms/production-preflight-runbook.md §Stage 2, and
# docs/awcms/database-migrations.md §Langkah 0. Until this file existed those
# were instructions to run a script nobody had written.
#
# ## Bash, not Bun (AGENTS.md #14)
#
# The Bun-only rule covers application and tooling code. This is an OS-level ops
# wrapper around the `pg_dump`/`pg_restore` binaries that ship with PostgreSQL
# itself, and it has to run inside a container that has those binaries and no
# Bun — so it is plain Bash, deliberately.
#
# ## How this runs against a Coolify-managed database
#
# PostgreSQL here is a Coolify-managed container with NO published port (see
# docs/awcms/environments.md §Menjalankan migrasi). The working shape is the
# same one-shot container the migration runbook uses: share the DB container's
# network namespace so the DSN can say `127.0.0.1`, and use the SAME PostgreSQL
# image tag as the server so `pg_dump` is version-matched (an older `pg_dump`
# refuses a newer server outright).
#
#   docker run --rm --network container:<db-container> \
#     -v /var/backups/awcms:/backup \
#     -v /opt/awcms/deploy/backup:/scripts:ro \
#     -e DATABASE_URL="postgres://<owner>:<pw>@127.0.0.1:5432/<db>" \
#     -e BACKUP_DIR=/backup \
#     postgres:18.4 \
#     bash /scripts/backup-postgres.sh
#
# `docker exec <app-container> ...` is NOT an option: the app image is runtime
# only and the app container's name changes on every Coolify deploy.
#
# ## What this script does NOT do
#
# docs/awcms/production-preflight-runbook.md §Stage 2 and doc 07 describe a
# richer model — at-rest encryption (`.dump.enc`), an HMAC-signed manifest,
# `offsite-copy.sh`, `restore-drill.sh`. None of that is implemented here; this
# script writes a plain `--format=custom` dump plus a `sha256` sidecar. Rather
# than let an operator believe otherwise, it FAILS LOUDLY when the encryption /
# HMAC key variables from that runbook are set (see `refuse_unimplemented`).
#
# ## Environment
#
#   DATABASE_URL            required, non-empty. Owner/privileged role (the same
#                           one that runs `bun run db:migrate`), because the dump
#                           has to be able to read every table. Never printed.
#   BACKUP_DATABASE_URL     optional override for DATABASE_URL, so a host that
#                           already exports the app's DSN can point backups
#                           somewhere else without unsetting it.
#   BACKUP_DIR              default /var/backups/awcms
#   BACKUP_LABEL            default awcms — filename prefix
#   BACKUP_RETENTION_DAYS   default 14; 0 disables pruning entirely
#
# Output: $BACKUP_DIR/<label>_<db>_<UTC timestamp>.dump plus a `.sha256` sidecar
# written in `sha256sum -c` format, so verification is one command anywhere.

set -euo pipefail

readonly DEFAULT_BACKUP_DIR="/var/backups/awcms"
readonly DEFAULT_BACKUP_LABEL="awcms"
readonly DEFAULT_RETENTION_DAYS="14"

# Globals, because the EXIT trap and the URL parser both need to outlive the
# function scope they are written in.
PARTIAL_PATH=""
SOURCE_DATABASE=""

die() {
  printf 'backup-postgres: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'backup-postgres: %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "'$1' not found in PATH. Run this inside an image that ships the PostgreSQL client binaries (e.g. postgres:18.4), version-matched to the server."
}

# The preflight runbook tells operators to pass these. Ignoring them silently
# would leave someone believing an unencrypted dump is encrypted, which is worse
# than not supporting encryption at all.
refuse_unimplemented() {
  local name
  for name in BACKUP_ENCRYPTION_KEY_FILE BACKUP_HMAC_KEY_FILE; do
    if [ -n "${!name-}" ]; then
      die "$name is set, but at-rest encryption and manifest signing are NOT implemented by this script — it writes a plain --format=custom dump plus a sha256 sidecar. docs/awcms/production-preflight-runbook.md §Stage 2 overstates what exists. Unset $name and protect the dump with filesystem permissions and off-host copies, or implement the encrypted variant first."
    fi
  done
}

# Percent-decoding, because libpq wants the decoded value and a URL-encoded
# password ("%40" for "@") is the normal way to carry one through a DSN.
urldecode() {
  local encoded="$1"
  printf '%b' "${encoded//%/\\x}"
}

# Splits DATABASE_URL into libpq environment variables instead of passing the
# DSN on the command line: argv is world-readable through `ps`, a process's
# environment is not. Sets PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE and the
# global SOURCE_DATABASE.
export_libpq_env_from_url() {
  local url="$1"
  local rest userinfo hostpart hostport query user pass host port dbname

  case "$url" in
    postgres://* | postgresql://*) ;;
    *) die "connection URL must use the postgres:// or postgresql:// scheme." ;;
  esac

  rest="${url#*://}"

  query=""
  case "$rest" in
    *\?*)
      query="${rest#*\?}"
      rest="${rest%%\?*}"
      ;;
  esac

  userinfo=""
  hostpart="$rest"
  # Rightmost '@' is the separator: everything before it is userinfo.
  case "$rest" in
    *@*)
      userinfo="${rest%@*}"
      hostpart="${rest##*@}"
      ;;
  esac

  case "$hostpart" in
    */*)
      dbname="${hostpart#*/}"
      hostport="${hostpart%%/*}"
      ;;
    *)
      die "connection URL has no database name."
      ;;
  esac

  [ -n "$dbname" ] || die "connection URL has no database name."

  host="${hostport%%:*}"
  port=""
  case "$hostport" in
    *:*) port="${hostport##*:}" ;;
  esac
  [ -n "$host" ] || die "connection URL has no host."

  user="${userinfo%%:*}"
  pass=""
  case "$userinfo" in
    *:*) pass="${userinfo#*:}" ;;
  esac

  # Every assignment is its own `if`: under `set -e` a bare `[ ... ] && x=y`
  # whose test is false returns 1 and kills the script.
  PGHOST="$(urldecode "$host")"
  export PGHOST
  PGDATABASE="$(urldecode "$dbname")"
  export PGDATABASE
  if [ -n "$port" ]; then
    export PGPORT="$port"
  fi
  if [ -n "$user" ]; then
    PGUSER="$(urldecode "$user")"
    export PGUSER
  fi
  if [ -n "$pass" ]; then
    PGPASSWORD="$(urldecode "$pass")"
    export PGPASSWORD
  fi

  case "$query" in
    *sslmode=*)
      local sslmode="${query##*sslmode=}"
      export PGSSLMODE="${sslmode%%&*}"
      ;;
  esac

  SOURCE_DATABASE="$PGDATABASE"
}

main() {
  refuse_unimplemented
  require_command pg_dump
  require_command pg_restore
  require_command sha256sum

  local database_url="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
  [ -n "$database_url" ] ||
    die "DATABASE_URL (or BACKUP_DATABASE_URL) is unset or empty. Refusing to run — a backup script with no target is a backup that never happens."

  export_libpq_env_from_url "$database_url"
  # Nothing below may echo $database_url, $PGPASSWORD, or anything derived from
  # them. The sha256 digest and the database NAME are not credentials.
  unset database_url

  local backup_dir="${BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
  local label="${BACKUP_LABEL:-$DEFAULT_BACKUP_LABEL}"
  local retention_days="${BACKUP_RETENTION_DAYS:-$DEFAULT_RETENTION_DAYS}"

  case "$retention_days" in
    '' | *[!0-9]*)
      die "BACKUP_RETENTION_DAYS must be a non-negative integer (got a non-numeric value)."
      ;;
  esac

  # 0700 dir, 0600 files: a dump is the whole database in one file.
  umask 077
  mkdir -p "$backup_dir"

  local timestamp
  timestamp="$(date -u +%Y%m%d_%H%M%SZ)"

  local base_name="${label}_${SOURCE_DATABASE}_${timestamp}.dump"
  local dump_path="${backup_dir}/${base_name}"

  if [ -e "$dump_path" ]; then
    die "refusing to overwrite an existing backup: $dump_path"
  fi

  # Global, not local: the EXIT trap has to be able to read it after `exit`
  # unwinds out of this function.
  PARTIAL_PATH="${dump_path}.partial"
  # A killed pg_dump must not leave something that looks like a backup.
  trap 'rm -f -- "$PARTIAL_PATH"' EXIT

  info "dumping database '${SOURCE_DATABASE}' from ${PGHOST}:${PGPORT:-5432}"

  # --format=custom is what makes selective/parallel restore possible at all,
  # and is what restore-postgres.sh expects. --no-password never prompts: an
  # interactive password prompt under cron is a job that hangs forever instead
  # of failing.
  pg_dump \
    --format=custom \
    --no-password \
    --file="$PARTIAL_PATH"

  # Only now does the file get its real name — anything found under the final
  # name is a dump pg_dump finished writing.
  mv -- "$PARTIAL_PATH" "$dump_path"
  trap - EXIT

  (cd "$backup_dir" && sha256sum "$base_name" >"${base_name}.sha256")

  # "Verified" means verified, not "the command exited 0". Two cheap proofs:
  # the sidecar matches the bytes on disk, and pg_restore can parse the whole
  # table of contents (which a truncated dump cannot).
  (cd "$backup_dir" && sha256sum -c "${base_name}.sha256" >/dev/null) ||
    die "checksum verification failed immediately after writing $dump_path — the storage under $backup_dir is not trustworthy."

  pg_restore --list "$dump_path" >/dev/null ||
    die "$dump_path is not a readable custom-format archive. Do not count this run as a backup."

  local size digest
  size="$(wc -c <"$dump_path" | tr -d ' ')"
  digest="$(cut -d' ' -f1 <"${backup_dir}/${base_name}.sha256")"

  info "wrote ${dump_path} (${size} bytes)"
  info "sha256 ${digest}"
  info "verified: sidecar checksum matches, archive table of contents readable"

  if [ "$retention_days" -gt 0 ]; then
    local pruned=0
    while IFS= read -r -d '' stale; do
      rm -f -- "$stale" "${stale}.sha256"
      pruned=$((pruned + 1))
      info "pruned ${stale}"
    done < <(find "$backup_dir" -maxdepth 1 -type f -name "${label}_*.dump" -mtime "+${retention_days}" -print0)
    info "retention: ${retention_days} day(s), ${pruned} dump(s) pruned"
  else
    info "retention: BACKUP_RETENTION_DAYS=0, pruning disabled"
  fi

  # A dump that was never test-restored is not verified evidence. This script
  # proves the file is readable; restore-postgres.sh proves it RESTORES.
  info "next: ./deploy/backup/restore-postgres.sh ${dump_path}"
}

main "$@"
