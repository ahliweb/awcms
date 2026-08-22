#!/usr/bin/env bash
# Keep AWCMS application logs after the container that wrote them is gone.
#
# THE PROBLEM
#
# The app logs structured JSON to stdout, and every log line this project needs
# for debugging — `correlationId`, the ABAC decision log, provider failures —
# goes there. Docker's `json-file` driver keeps it beside the container, and
# Coolify REPLACES the container on every deploy. So the logs of the release you
# are debugging are deleted by the deploy that fixed it, which is the worst
# possible moment to lose them.
#
# In-container rotation (`max-size`/`max-file`, as `hermes` uses) does not help:
# it bounds a file that is discarded whole.
#
# WHAT THIS DOES
#
# Follows the CURRENT app container's stdout into a dated file on the host, and
# re-attaches when the container name changes — which is exactly the deploy event
# that used to lose them. Run from cron every minute; it is a no-op when a tailer
# for the current container is already alive.
#
# Deliberately NOT a log SHIPPER to a third party: that is a decision about where
# this deployment's data is allowed to go, and it is not one a script should make
# on its own. This is the smaller, uncontroversial half — the logs stop
# disappearing — and it leaves the destination question open rather than
# answering it quietly. `setLogSink` in the app remains the seam for a real SIEM.
#
# Install:
#   scp ops/ship-logs.sh dinkes-prod:/home/admin1/awcms-jobs/ && chmod +x
#   crontab:  * * * * * /home/admin1/awcms-jobs/ship-logs.sh >> …/ship-logs.log 2>&1
set -uo pipefail

DEST="${AWCMS_LOG_DEST:-/home/admin1/logs/awcms}"
APP_FILTER="${AWCMS_APP_FILTER:-n3gg3qudm91kqdy62znmyxuq}"
KEEP_DAYS="${AWCMS_LOG_KEEP_DAYS:-30}"
MARKER="${DEST}/.current-container"

log() { echo "$(date -Is) ship-logs: $*"; }

mkdir -p "$DEST"

APP=$(docker ps --filter "name=${APP_FILTER}" --format '{{.Names}}' | head -1)
if [ -z "$APP" ]; then
  log "app container not running — nothing to follow"
  exit 0
fi

PREV=""; [ -f "$MARKER" ] && PREV=$(cat "$MARKER")

# Is a tailer for THIS container already alive? `pgrep -f` would also match this
# script's own command line, so the pattern is anchored on `docker logs` and the
# container name, which this script never has together in its own argv.
if [ "$PREV" = "$APP" ] && pgrep -f "docker logs -f --timestamps ${APP}" >/dev/null 2>&1; then
  exit 0
fi

# The container changed (a deploy) or the tailer died. Stop the old one — its
# container is gone, so it is producing nothing and holding a pipe open.
if [ -n "$PREV" ] && [ "$PREV" != "$APP" ]; then
  pkill -f "docker logs -f --timestamps ${PREV}" >/dev/null 2>&1 || true
  log "container changed ${PREV} -> ${APP} (deploy); re-attaching"
fi

# `--timestamps` so a line's time survives even when the app's own JSON is
# truncated, and no `--since`: a new container's history starts at zero and we
# want all of it. setsid + nohup so cron exiting does not take the tailer with it.
#
# WHY THE OUTPUT GOES THROUGH A LOOP AND NOT A REDIRECT
#
# This used to be `>> "${DEST}/app-$(date -u +%Y-%m-%d).log"`. A redirect names
# its file ONCE, when the shell spawns the tailer, and the file descriptor then
# lives until the container changes — which on a stable deployment is weeks. The
# two consequences compound:
#
#   - Today's lines land in a file dated by the LAST DEPLOY. An operator reading
#     `app-2026-08-01.log` to answer "what happened last night" is reading a
#     file whose name is the one thing about it that is wrong.
#   - The `-mtime` sweep below can never reclaim it: the file keeps being
#     written, so its mtime is always today no matter how old its name is. The
#     retention policy applied to every file except the one actually growing.
#
# The loop re-derives the date per line, so the writer follows midnight. `printf
# -v ... %(...)T` is a bash builtin — no `date` fork per line, which matters on
# a log this script exists to keep all of. `TZ=UTC` because `%(...)T` formats in
# LOCAL time and the filenames are UTC (`date -u` above was explicit about it).
# `>>` per line reopens the file, so a rotation or a delete underneath is
# survivable rather than a silent write into an unlinked inode.
setsid nohup bash -c '
  set -uo pipefail
  export TZ=UTC
  docker logs -f --timestamps "$2" 2>&1 | while IFS= read -r line; do
    printf -v day "%(%Y-%m-%d)T" -1
    printf "%s\n" "$line" >> "$1/app-${day}.log"
  done
' _ "$DEST" "$APP" >/dev/null 2>&1 &

echo "$APP" > "$MARKER"
log "following ${APP}"

# Retention. These files are the debugging record, not an archive — 30 days is
# well past the window in which anyone asks "what happened last night". This
# only became a real policy with the loop above: while one descriptor stayed
# open on one file forever, the file the operator most wanted bounded was the
# single file this could never touch.
find "$DEST" -maxdepth 1 -name 'app-*.log' -mtime "+${KEEP_DAYS}" -delete
