#!/usr/bin/env bash
#
# restore-postgres.sh — restore a dump written by backup-postgres.sh.
#
# Two modes, and the DEFAULT is the harmless one:
#
#   restore-postgres.sh <dump>                  verify-only drill: restore into a
#                                               scratch database, check it, DROP it
#   restore-postgres.sh <dump> --target=<db>    real restore, destructive
#
# A dump that was never test-restored is not evidence of anything. The drill
# exists so "restore tested" can be a fact with a timestamp instead of a belief
# (docs/awcms/07_sprint_testing_production_readiness.md §Restore SOP ringkas,
# docs/awcms/production-preflight-runbook.md §Stage 2).
#
# ## Bash, not Bun (AGENTS.md #14)
#
# Same reason as backup-postgres.sh: this wraps the `pg_restore`/`psql` binaries
# inside an image that has PostgreSQL and no Bun.
#
# ## How this runs against a Coolify-managed database
#
# The database container publishes no port, so run this the same one-shot way
# the migration runbook does (docs/awcms/environments.md §Menjalankan migrasi),
# in the image whose PostgreSQL version matches the server:
#
#   docker run --rm --network container:<db-container> \
#     -v /var/backups/awcms:/backup \
#     -v /opt/awcms/deploy/backup:/scripts:ro \
#     -e DATABASE_URL="postgres://<owner>:<pw>@127.0.0.1:5432/<db>" \
#     postgres:18.4 \
#     bash /scripts/restore-postgres.sh /backup/awcms_<db>_<timestamp>.dump
#
# The role in DATABASE_URL needs CREATEDB (the drill creates and drops its own
# scratch database) and must be the dump's owner role or a superuser — normally
# the same privileged role that runs `bun run db:migrate`. Restoring as a
# lesser role fails on `COMMENT ON EXTENSION` for pgcrypto/pg_trgm, which is a
# privilege problem wearing a restore error's clothes.
#
# ## What this script does NOT do
#
# It does not decrypt anything and it does not verify an HMAC-signed manifest.
# docs/awcms/production-preflight-runbook.md §Stage 2 describes both, and both
# are unimplemented; that runbook's `.dump.enc` filename does not exist. This
# script verifies the `.sha256` sidecar BEFORE any mutation, which is the part
# that does exist. Handed a `.enc` file it refuses rather than guess.
#
# ## Environment
#
#   DATABASE_URL            required, non-empty. Never printed.
#   RESTORE_DATABASE_URL    optional override for DATABASE_URL.
#   RESTORE_SCRATCH_DB      scratch database name, default awcms_restore_test

set -euo pipefail

readonly DEFAULT_SCRATCH_DB="awcms_restore_test"

# Globals: read by the EXIT trap and set by the URL parser, both of which have
# to outlive the function that writes them.
SCRATCH_CREATED=""
SOURCE_DATABASE=""

die() {
  printf 'restore-postgres: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'restore-postgres: %s\n' "$*"
}

usage() {
  cat <<'USAGE'
Usage: restore-postgres.sh <dump-file> [--target=<dbname>] [--yes] [--keep]

  (no --target)   Verify-only drill. Restores into a scratch database, asserts
                  the restored schema looks like AWCMS, then drops it. Never
                  touches a live database.
  --target=<db>   DESTRUCTIVE restore into an existing database using
                  `pg_restore --clean --if-exists`. Refused when <db> is the
                  database named in DATABASE_URL.
  --yes           Skip the type-the-database-name confirmation for --target.
                  Required for non-interactive use; there is no other way to
                  make this script destructive without a human present.
  --keep          Drill only: leave the scratch database in place for
                  inspection instead of dropping it.
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "'$1' not found in PATH. Run this inside an image that ships the PostgreSQL client binaries (e.g. postgres:18.4), version-matched to the server."
}

urldecode() {
  local encoded="$1"
  printf '%b' "${encoded//%/\\x}"
}

# Same parser as backup-postgres.sh, duplicated on purpose: each of these two
# files has to be copyable to a host on its own, and a shared `_lib.sh` that
# only one of them travels with is a broken script waiting to happen.
# Credentials go into the environment, never onto argv, where `ps` would show
# them to every user on the host.
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

# Runs against the connection database (PGDATABASE), which is never the scratch
# database — you cannot drop the database you are connected to.
admin_sql() {
  psql --no-password --quiet --no-psqlrc --set=ON_ERROR_STOP=1 --command "$1" >/dev/null
}

scalar_in() {
  local dbname="$1"
  local query="$2"
  psql --dbname="$dbname" --no-password --no-psqlrc --set=ON_ERROR_STOP=1 \
    --tuples-only --no-align --command "$query"
}

drop_scratch() {
  if [ -n "$SCRATCH_CREATED" ]; then
    info "dropping scratch database '${SCRATCH_CREATED}'"
    admin_sql "DROP DATABASE IF EXISTS \"${SCRATCH_CREATED}\" WITH (FORCE)"
    SCRATCH_CREATED=""
  fi
}

# A drill that dies halfway must not leave a half-restored database behind for
# the next run to trip over.
on_exit() {
  local status=$?
  if [ "$status" -ne 0 ]; then
    drop_scratch || true
  fi
  exit "$status"
}

verify_dump_integrity() {
  local dump_path="$1"
  local dump_dir base_name

  dump_dir="$(cd "$(dirname "$dump_path")" && pwd)"
  base_name="$(basename "$dump_path")"

  if [ -f "${dump_dir}/${base_name}.sha256" ]; then
    (cd "$dump_dir" && sha256sum -c "${base_name}.sha256" >/dev/null) ||
      die "sha256 sidecar does not match ${dump_path}. The dump is corrupt or truncated — STOP, and do not restore it anywhere."
    info "sha256 sidecar verified"
  else
    # Loud, not fatal: dumps predating the sidecar convention still restore, and
    # a drill on an unverified dump is more useful than no drill. It just is not
    # the same evidence.
    info "WARNING: no ${base_name}.sha256 sidecar next to the dump — integrity NOT verified"
  fi

  pg_restore --list "$dump_path" >/dev/null ||
    die "${dump_path} is not a readable custom-format archive."
  info "archive table of contents readable"
}

# The three questions a restored AWCMS database has to answer. Counting rows is
# not the point; the point is that the migration ledger, the tenant table, and
# FORCE RLS all survived the round trip. A restore that silently loses
# `relforcerowsecurity` produces a database where tenant isolation is inert and
# everything still looks fine (docs/awcms/environments.md §Jebakan).
verify_restored_database() {
  local dbname="$1"
  local migrations tenants forced

  migrations="$(scalar_in "$dbname" "SELECT count(*) FROM awcms_schema_migrations")"
  [ "$migrations" -gt 0 ] ||
    die "restored database '${dbname}' has an empty awcms_schema_migrations — the restore produced no schema."

  tenants="$(scalar_in "$dbname" "SELECT count(*) FROM awcms_tenants")"

  forced="$(scalar_in "$dbname" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'r' AND c.relforcerowsecurity AND n.nspname = 'public'")"
  [ "$forced" -gt 0 ] ||
    die "restored database '${dbname}' has ZERO tables with FORCE ROW LEVEL SECURITY. Tenant isolation did not survive the restore — treat this backup as unusable."

  info "verified: ${migrations} applied migration(s), ${tenants} tenant row(s), ${forced} table(s) with FORCE RLS"
}

main() {
  local dump_path=""
  local target=""
  local assume_yes=""
  local keep_scratch=""

  if [ "$#" -eq 0 ]; then
    usage >&2
    exit 1
  fi

  local arg
  for arg in "$@"; do
    case "$arg" in
      --help | -h)
        usage
        exit 0
        ;;
      --target=*)
        target="${arg#--target=}"
        # An empty --target= would fall through to the drill path, which is the
        # opposite of what the operator asked for. Refuse instead.
        [ -n "$target" ] || die "--target= given with an empty database name."
        ;;
      --yes) assume_yes="1" ;;
      --keep) keep_scratch="1" ;;
      -*) die "unknown option: $arg" ;;
      *)
        [ -z "$dump_path" ] || die "more than one dump file given."
        dump_path="$arg"
        ;;
    esac
  done

  [ -n "$dump_path" ] || die "no dump file given. See --help."
  [ -f "$dump_path" ] || die "dump file not found: $dump_path"

  case "$dump_path" in
    *.enc | *.gpg | *.age)
      die "'$dump_path' looks encrypted, and this script decrypts nothing. At-rest encryption described in docs/awcms/production-preflight-runbook.md §Stage 2 is NOT implemented — decrypt it yourself first, then restore the plain --format=custom dump."
      ;;
  esac

  require_command pg_restore
  require_command psql
  require_command sha256sum

  local database_url="${RESTORE_DATABASE_URL:-${DATABASE_URL:-}}"
  [ -n "$database_url" ] ||
    die "DATABASE_URL (or RESTORE_DATABASE_URL) is unset or empty. Refusing to run."

  export_libpq_env_from_url "$database_url"
  unset database_url

  # Integrity first. Nothing below this line is allowed to mutate anything
  # until the bytes on disk have been checked.
  verify_dump_integrity "$dump_path"

  trap on_exit EXIT

  if [ -z "$target" ]; then
    local scratch="${RESTORE_SCRATCH_DB:-$DEFAULT_SCRATCH_DB}"

    [ "$scratch" != "$SOURCE_DATABASE" ] ||
      die "scratch database name '${scratch}' is the database in DATABASE_URL. Set RESTORE_SCRATCH_DB to something disposable."

    info "drill mode: restoring into scratch database '${scratch}' (live databases untouched)"
    admin_sql "DROP DATABASE IF EXISTS \"${scratch}\" WITH (FORCE)"
    admin_sql "CREATE DATABASE \"${scratch}\""
    SCRATCH_CREATED="$scratch"

    pg_restore --dbname="$scratch" --no-password "$dump_path" ||
      die "pg_restore reported errors restoring into '${scratch}'. The drill FAILED — read the errors above before trusting this dump."

    verify_restored_database "$scratch"

    if [ -n "$keep_scratch" ]; then
      info "--keep given: scratch database '${scratch}' left in place. Drop it yourself when done."
      SCRATCH_CREATED=""
    else
      drop_scratch
    fi

    trap - EXIT
    info "restore drill PASSED for ${dump_path}"
    info "record the dump filename, its sha256, and this timestamp as the restore-test evidence (production-preflight-runbook.md Stage 2)"
    return 0
  fi

  # --- destructive path -----------------------------------------------------

  [ "$target" != "$SOURCE_DATABASE" ] ||
    die "--target='${target}' is the database named in DATABASE_URL. Connect through a different maintenance database (e.g. 'postgres') if you really mean to overwrite it — this guard exists so a typo cannot overwrite the database you happened to connect through."

  if [ -z "$assume_yes" ]; then
    if [ ! -t 0 ]; then
      die "--target requires either an interactive terminal for confirmation or an explicit --yes. Refusing to overwrite '${target}' unattended."
    fi
    printf 'About to OVERWRITE database "%s" with %s.\nThis is destructive (pg_restore --clean --if-exists).\nType the database name to continue: ' "$target" "$dump_path"
    local typed=""
    read -r typed
    [ "$typed" = "$target" ] || die "confirmation did not match '${target}'. Nothing was changed."
  fi

  info "restoring into '${target}' with --clean --if-exists"
  pg_restore --dbname="$target" --no-password --clean --if-exists "$dump_path" ||
    die "pg_restore reported errors restoring into '${target}'. The database is now in an UNKNOWN state — do not point traffic at it until the errors above are understood."

  verify_restored_database "$target"

  trap - EXIT
  info "restore into '${target}' complete"
}

main "$@"
