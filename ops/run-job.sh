#!/usr/bin/env bash
#
# AWCMS job runner (host side) — the thing every line of `awcms-jobs.crontab`
# calls.
#
# WHY IT EXISTS
#
# The production runtime image (`Dockerfile.production`, stage `runtime`) ships
# only `dist/`, `node_modules/` and `package.json`. None of the 32 job targets in
# the module registry can execute there — `bun run logs:audit:purge` answers
# `Module not found "scripts/audit-log-purge.ts"`. The `jobs` stage of the same
# Dockerfile is the same commit WITH `scripts/` and `src/`, and this script runs
# jobs in that image.
#
# WHY IT IS IN THE REPO
#
# It used to live only on the host, beside a hand-copied snapshot of the source
# used as a docker build context. That worked and it did not follow releases: a
# deploy changed the app while the snapshot stayed put, so the cron ran the
# PREVIOUS release's code against the NEW schema until somebody remembered to
# refresh it, and nothing reported that. Versioning the runner here means the
# scheduler and the app are updated by the same act.
#
# IMAGE RESOLUTION, in order:
#
#   1. `$AWCMS_JOBS_IMAGE` — an explicit pin, for a rollback or a test.
#   2. `ghcr.io/ahliweb/awcms-jobs:<tag>` — published by `release.yml` from the
#      same commit as the app image. Pulled if absent locally.
#   3. A local build from `$AWCMS_JOBS_CONTEXT` — the legacy path, kept because
#      Coolify prunes unreferenced images after every deploy and `awcms-jobs` is
#      never referenced by a running container, so it IS deleted every time.
#      Observed 2026-08-14: the first run after a redeploy failed with
#      `pull access denied for awcms-jobs`.
#
# Usage:
#   run-job.sh <bun-run-target> [extra args...]
#   run-job.sh logs:audit:purge --dry-run
set -euo pipefail

JOB="${1:?usage: run-job.sh <bun-run-target> [args...]   e.g. run-job.sh email:dispatch --dry-run}"
shift

IMAGE="${AWCMS_JOBS_IMAGE:-}"
REGISTRY_IMAGE="${AWCMS_JOBS_REGISTRY:-ghcr.io/ahliweb/awcms-jobs}"
TAG="${AWCMS_JOBS_TAG:-latest}"
CONTEXT="${AWCMS_JOBS_CONTEXT:-/home/admin1/awcms-jobs}"
APP_FILTER="${AWCMS_APP_FILTER:-n3gg3qudm91kqdy62znmyxuq}"
NETWORK="${AWCMS_DOCKER_NETWORK:-coolify}"

# The container's WORKDIR (`Dockerfile.production`) and the directory the two
# artefact-writing jobs default to underneath it. `data-lifecycle:archive-purge`
# writes `./var/data-lifecycle-archive` and `reporting:exports:dispatch` writes
# `./var/reporting-exports`, both relative to the working directory — so ONE
# mount at `var/` covers both without either job needing to be told anything.
CONTAINER_WORKDIR="${AWCMS_JOBS_WORKDIR:-/home/bun/app}"
DATA_DIR="${AWCMS_JOBS_DATA_DIR:-/var/lib/awcms-jobs}"

# The generated companions to this script. Kept beside it deliberately: a runner
# deployed without them must fail loudly rather than fall back to a partial
# environment, because a job missing a variable takes the code's default, does
# the inert thing, and reports success.
#
# `awcms-jobs.env-global` is what EVERY job gets. It is NOT called
# `awcms-jobs.env-allowlist` (Issue #1120): that older name held every variable,
# the job-specific secrets included, and was read by the previous runner. An old
# runner that finds only its old file keeps working with the old, complete list;
# this runner finds only the new names and refuses without them. Reusing the old
# name would have let a half-deployed host hand every job every secret.
GLOBAL="${AWCMS_JOBS_ENV_GLOBAL:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/awcms-jobs.env-global}"

# The job-scoped secrets (Issue #1120): `<job-target> <VAR>` lines. A secret in
# here is NOT in the global file, so it reaches only the job named on its line.
# Same fail-closed rule as the global file: without it a job that reads one of
# these would see it as unset, take the inert default, and report success — so a
# runner deployed without it refuses to run anything.
SCOPED="${AWCMS_JOBS_ENV_SCOPED:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/awcms-jobs.env-scoped}"

log() { echo "$(date -Is) run-job.sh: $*"; }

if [ -z "$IMAGE" ]; then
  IMAGE="${REGISTRY_IMAGE}:${TAG}"
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    if docker pull -q "$IMAGE" >/dev/null 2>&1; then
      log "pulled $IMAGE"
    else
      # The registry image does not exist yet (it ships from `release.yml`).
      # Fall back to a local build — but CHECK FIRST whether we already built
      # one. The original version of this branch did not, so with 23 jobs on
      # timers it ran `docker build` every couple of minutes, forever. It was
      # invisible in the job's own output (each run still succeeded) and showed
      # up only as `local build complete` on every single tick.
      IMAGE="awcms-jobs:local"
      if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
        log "$REGISTRY_IMAGE:$TAG unavailable — building $IMAGE from $CONTEXT"
        docker build -q -t "$IMAGE" "$CONTEXT" >/dev/null
        log "local build complete"
      fi
    fi
  fi
fi

APP=$(docker ps --filter "name=${APP_FILTER}" --format '{{.Names}}' | head -1)
if [ -z "$APP" ]; then
  log "app container not running — skipping $JOB" >&2
  exit 1
fi

ENVFILE=$(mktemp /tmp/awcms-job-env.XXXXXX)
chmod 600 "$ENVFILE"
trap 'rm -f "$ENVFILE"' EXIT

if [ ! -r "$GLOBAL" ]; then
  log "global env file not readable at $GLOBAL — refusing to run $JOB" >&2
  log "  Deploy ops/awcms-jobs.env-global beside this script, or point" >&2
  log "  AWCMS_JOBS_ENV_GLOBAL at it. Running with a partial environment" >&2
  log "  makes a job take code defaults and report success." >&2
  exit 1
fi

if [ ! -r "$SCOPED" ]; then
  log "job-scoped env file not readable at $SCOPED — refusing to run $JOB" >&2
  log "  Deploy ops/awcms-jobs.env-scoped beside this script (BOTH generated" >&2
  log "  files go next to run-job.sh), or point AWCMS_JOBS_ENV_SCOPED at it." >&2
  log "  Without it a job that reads a scoped secret takes the code default" >&2
  log "  and reports success." >&2
  exit 1
fi

# Env is read from the RUNNING app container each tick, so a Coolify env change
# takes effect on the next run. The container name changes on every deploy, so it
# is resolved above and never hardcoded.
#
# Selected by exact NAME from the generated global file, not by prefix. The prefix
# pattern this replaced dropped 81 of the 171 variables the code reads —
# including both artefact-root paths, every `TENANT_DOMAIN_CLOUDFLARE_*` (because
# `^CLOUDFLARE_` is anchored and those do not start with it), and every
# `VISITOR_ANALYTICS_*` retention window that `analytics:purge` exists to
# enforce. `-F -x` on the name half is what makes a partial match impossible.
NAMES=$(grep -vE '^\s*(#|$)' "$GLOBAL" || true)

# A comments-only or blank global file makes grep exit 1, which `set -e` would
# turn into a silent exit before any message. Say why instead: a runner with no
# global names would start every job without DATABASE_URL.
if [ -z "$NAMES" ]; then
  log "global env file $GLOBAL lists no variables — refusing to run $JOB" >&2
  log "  It is empty or only comments (truncated or mis-generated). Replace it" >&2
  log "  with the awcms-jobs.env-global from the same release as run-job.sh." >&2
  exit 1
fi

# Add the secrets scoped to THIS job, after checking BOTH files, in one pass.
# Every check below refuses the run, because each one is a way for a job to end
# up with the wrong environment and still report success:
#
# - a carriage return (a CRLF checkout): `PUSH_VAPID_PRIVATE_KEY\r` is a name
#   that matches nothing, so the grant would silently not happen;
# - a line that is not exactly two fields: a skipped grant is a job missing its
#   secret;
# - a scoped VAR that is ALSO in the global file: the global file reaches every
#   job, so the scoping would be void. This is the signature of a version skew —
#   the new scoped file beside an old, complete global list;
# - no grant lines at all: an empty or truncated file would scope nothing;
# - the two files carry different fingerprints, or one has none: the generator
#   writes the SAME digest into both, so a pair that disagrees comes from
#   different releases (an old scoped file beside a new global file runs, exits
#   0, and leaves jobs without their provider secrets).
#
# The job is compared as a whole STRING (`($1 "") == (ENVIRON["JOB"] "")`, never a
# regex or prefix, and never numerically even when a target looks like a number),
# so `push:dispatch` does not match `push:dispatch:dry` or `xpush:dispatch`. It is
# passed through the environment, not `awk -v`, so a backslash in a target is not
# interpreted.
SCOPED_NAMES=$(JOB="$JOB" awk '
  /\r/ { printf "%s line %d has a carriage return (CRLF)\n", FILENAME, FNR > "/dev/stderr"; bad = 1; next }
  /^# awcms-jobs-env-fingerprint: / {
    if ((FILENAME in fp) || NF != 3 || length($3) != 64 || $3 !~ /^[0-9a-f]+$/) {
      printf "%s has a duplicate or malformed fingerprint line\n", FILENAME > "/dev/stderr"; bad = 1
    } else { fp[FILENAME] = $3 }
    next
  }
  /^[[:space:]]*(#|$)/ { next }
  FILENAME == ARGV[1] { gl[$0] = 1; next }
  NF != 2 { printf "malformed line %d: %s\n", FNR, $0 > "/dev/stderr"; bad = 1; next }
  { grants++ }
  ($2 in gl) { printf "%s is in BOTH the global file and the scoped file (stale global file?)\n", $2 > "/dev/stderr"; bad = 1 }
  ($1 "") == (ENVIRON["JOB"] "") { print $2 }
  END {
    if (grants == 0) { print "the scoped file has no grant lines" > "/dev/stderr"; bad = 1 }
    g = (ARGV[1] in fp) ? fp[ARGV[1]] : "none"
    c = (ARGV[2] in fp) ? fp[ARGV[2]] : "none"
    if (g == "none" || c == "none" || g != c) {
      printf "fingerprint mismatch: %s=%s, %s=%s (the files come from different releases, or one has no fingerprint)\n", ARGV[1], g, ARGV[2], c > "/dev/stderr"
      bad = 1
    }
    exit bad
  }
' "$GLOBAL" "$SCOPED") || {
  log "env files $GLOBAL / $SCOPED are inconsistent — refusing to run $JOB" >&2
  log "  Replace awcms-jobs.env-global, awcms-jobs.env-scoped and run-job.sh" >&2
  log "  together from the same release." >&2
  exit 1
}
if [ -n "$SCOPED_NAMES" ]; then
  NAMES=$(printf '%s\n%s\n' "$NAMES" "$SCOPED_NAMES")
fi

docker exec "$APP" printenv \
  | awk -F= 'NR==FNR { want[$0]=1; next } ($1 in want)' <(printf '%s\n' "$NAMES") - \
  > "$ENVFILE"

COPIED=$(wc -l < "$ENVFILE" | tr -d ' ')
if [ "$COPIED" -eq 0 ]; then
  log "copied 0 environment variables from $APP — refusing to run $JOB" >&2
  log "  Every job would run with no DATABASE_URL and most would still exit 0." >&2
  exit 1
fi

# The volume the finding was really about. Without `-v`, `docker run --rm` gave
# `data-lifecycle:archive-purge` and `reporting:exports:dispatch` a filesystem
# that was deleted seconds later, while `awcms_data_lifecycle_archive_manifests`
# and `awcms_report_export_runs` recorded the artefacts as PRESENT. The README's
# restore procedure could not be executed and a scheduled export 404'd on
# download — and nothing reported either, because writing the file really did
# succeed.
mkdir -p "$DATA_DIR"

# A path the operator has overridden to somewhere OUTSIDE the mount is the same
# defect wearing a configuration. Named rather than silently tolerated, because
# the symptom is identical to success.
while IFS='=' read -r name value; do
  case "$name" in
    DATA_LIFECYCLE_ARCHIVE_ROOT_PATH | REPORTING_EXPORT_ROOT_PATH)
      case "$value" in
        ./var/* | var/* | "$CONTAINER_WORKDIR"/var/*) ;;
        *)
          log "WARNING: $name=$value is outside the mounted $CONTAINER_WORKDIR/var" >&2
          log "  Artefacts written there vanish with the container while the" >&2
          log "  database keeps recording them as present." >&2
          ;;
      esac
      ;;
  esac
done < "$ENVFILE"

log "$JOB $* (image=$IMAGE app=$APP env=$COPIED vars data=$DATA_DIR)"
docker run --rm --network "$NETWORK" --env-file "$ENVFILE" \
  -v "$DATA_DIR:$CONTAINER_WORKDIR/var" \
  "$IMAGE" bun run "$JOB" "$@"
