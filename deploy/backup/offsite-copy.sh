#!/usr/bin/env bash
#
# offsite-copy.sh — copy a completed, verified backup artifact (and its
# sidecars) away from the primary host, over SSH.
#
# This is the 3-2-1 leg: backup-postgres.sh already proves the artifact is
# readable on the primary host; this script is what makes a primary-host
# disaster (disk failure, host compromise, accidental `rm -rf`) survivable.
#
# ## What this deliberately does NOT do
#
# It never deletes anything on the primary host. A partially-succeeded
# transfer, or any transfer at all, is not a reason to remove the only
# known-good local copy — that is a separate, explicit, human decision
# (retention pruning already lives in backup-postgres.sh's own
# BACKUP_RETENTION_DAYS, on a schedule an operator chose deliberately).
#
# ## Bash, not Bun (AGENTS.md #14) — same reason as its siblings: this wraps
# `rsync`/`ssh`, OS-level binaries, not application logic.
#
# ## Environment
#
#   OFFSITE_SSH_TARGET     required, non-empty. `user@host:/absolute/path`
#                          (an rsync-style remote destination). Never printed
#                          in a way that would expose an embedded credential —
#                          it should not contain one; use SSH key auth
#                          (OFFSITE_SSH_KEY_FILE) instead.
#   OFFSITE_SSH_KEY_FILE   optional. Path to a private SSH key used for
#                          authentication. Recommended over agent/default-key
#                          reliance for unattended cron use.
#   OFFSITE_SSH_PORT       optional, default 22.
#   OFFSITE_RETRIES        optional, default 3. Total attempts, not extra
#                          retries — 1 means "try once, no retry".
#   OFFSITE_RETRY_DELAY_SECONDS  optional, default 10. Backoff between
#                          attempts (linear: attempt N waits N * this many
#                          seconds).
#   OFFSITE_TIMEOUT_SECONDS      optional, default 300. Per-attempt wall-clock
#                          timeout via `timeout`, so a stalled network never
#                          hangs a cron job forever.
#
# Usage:
#   offsite-copy.sh <file> [<file> ...]
#
# Copies each given file (typically the encrypted artifact, its `.sha256`,
# and its `.manifest.json`/`.manifest.json.hmac` — everything needed to
# verify and restore it elsewhere) to OFFSITE_SSH_TARGET. Exits non-zero, and
# prints exactly which file(s) failed, if any transfer does not succeed after
# all retries — that failure must be visible to whatever calls this (cron
# mailer, CI job log, alerting), never swallowed.

set -euo pipefail

readonly DEFAULT_RETRIES="3"
readonly DEFAULT_RETRY_DELAY_SECONDS="10"
readonly DEFAULT_TIMEOUT_SECONDS="300"
readonly DEFAULT_SSH_PORT="22"

die() {
  printf 'offsite-copy: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'offsite-copy: %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 ||
    die "'$1' not found in PATH."
}

usage() {
  cat <<'USAGE'
Usage: offsite-copy.sh <file> [<file> ...]

Copies each file to OFFSITE_SSH_TARGET (user@host:/path) over rsync/ssh, with
retries and a per-attempt timeout. Never deletes anything locally, regardless
of outcome. Exits non-zero and names every file that ultimately failed.
USAGE
}

copy_one_with_retry() {
  local file="$1"
  local target="$2"
  local ssh_cmd="$3"
  local retries="$4"
  local delay="$5"
  local timeout_seconds="$6"

  local attempt=1
  while [ "$attempt" -le "$retries" ]; do
    info "copying $(basename "$file") to ${target} (attempt ${attempt}/${retries})"
    if timeout "${timeout_seconds}s" rsync \
      --archive \
      --checksum \
      --partial \
      --partial-dir=.rsync-partial \
      -e "$ssh_cmd" \
      -- "$file" "$target/"; then
      info "$(basename "$file"): transferred successfully"
      return 0
    fi

    info "$(basename "$file"): attempt ${attempt} failed"
    if [ "$attempt" -lt "$retries" ]; then
      local wait_seconds=$((delay * attempt))
      info "retrying in ${wait_seconds}s"
      sleep "$wait_seconds"
    fi
    attempt=$((attempt + 1))
  done

  return 1
}

main() {
  if [ "$#" -eq 0 ]; then
    usage >&2
    exit 1
  fi

  case "${1-}" in
    --help | -h)
      usage
      exit 0
      ;;
  esac

  require_command rsync
  require_command ssh
  require_command timeout

  local target="${OFFSITE_SSH_TARGET-}"
  [ -n "$target" ] || die "OFFSITE_SSH_TARGET is unset or empty. Refusing to run — an off-site copy with no destination is not an off-site copy."

  local port="${OFFSITE_SSH_PORT:-$DEFAULT_SSH_PORT}"
  local retries="${OFFSITE_RETRIES:-$DEFAULT_RETRIES}"
  local delay="${OFFSITE_RETRY_DELAY_SECONDS:-$DEFAULT_RETRY_DELAY_SECONDS}"
  local timeout_seconds="${OFFSITE_TIMEOUT_SECONDS:-$DEFAULT_TIMEOUT_SECONDS}"

  case "$retries" in '' | *[!0-9]*) die "OFFSITE_RETRIES must be a positive integer." ;; esac
  [ "$retries" -ge 1 ] || die "OFFSITE_RETRIES must be at least 1."

  # -o BatchMode=yes: never fall back to an interactive password/passphrase
  # prompt — under cron that is a hang forever, not a failure.
  local ssh_cmd="ssh -p ${port} -o BatchMode=yes -o ConnectTimeout=15"
  if [ -n "${OFFSITE_SSH_KEY_FILE-}" ]; then
    [ -f "$OFFSITE_SSH_KEY_FILE" ] || die "OFFSITE_SSH_KEY_FILE does not exist: $OFFSITE_SSH_KEY_FILE"
    ssh_cmd="${ssh_cmd} -i ${OFFSITE_SSH_KEY_FILE}"
  fi

  local failed=()
  local file
  for file in "$@"; do
    [ -f "$file" ] || { info "SKIP: not a file: $file"; failed+=("$file (not found)"); continue; }
    if ! copy_one_with_retry "$file" "$target" "$ssh_cmd" "$retries" "$delay" "$timeout_seconds"; then
      failed+=("$file")
    fi
  done

  if [ "${#failed[@]}" -gt 0 ]; then
    info "FAILED after ${retries} attempt(s) each: ${failed[*]}"
    info "local copies are untouched — nothing was deleted because a transfer failed"
    exit 1
  fi

  info "all $# file(s) copied to ${target}"
}

main "$@"
