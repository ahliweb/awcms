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

# Env is read from the RUNNING app container each tick, so a Coolify env change
# takes effect on the next run. The container name changes on every deploy, so it
# is resolved above and never hardcoded.
docker exec "$APP" printenv \
  | grep -E '^(DATABASE_URL|WORKER_DATABASE_URL|SETUP_DATABASE_URL|EMAIL_|APP_URL|APP_ENV|LOG_LEVEL|AUTH_|REDIS_|R2_|NEWS_MEDIA_|PUSH_|VAPID_|FCM_|COMMENTS_|CLOUDFLARE_)' \
  > "$ENVFILE"

log "$JOB $* (image=$IMAGE app=$APP)"
docker run --rm --network "$NETWORK" --env-file "$ENVFILE" "$IMAGE" bun run "$JOB" "$@"
