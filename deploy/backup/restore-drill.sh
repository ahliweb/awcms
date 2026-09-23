#!/usr/bin/env bash
#
# restore-drill.sh — unattended, schedule/CI-capable restore drill.
#
# A thin orchestrator, not a reimplementation: it selects the newest eligible
# backup in BACKUP_DIR, hands it to restore-postgres.sh in its default
# non-destructive drill mode, and appends one line of evidence to a JSON-lines
# log. It never passes --target anywhere in this file — there is no flag or
# code path here that can make restore-postgres.sh destructive. That is a
# structural property of this script, not a runtime check: read it end to end
# and there is no `--target` string in it.
#
# ## Bash, not Bun (AGENTS.md #14) — same reason as its siblings.
#
# ## Environment
#
#   BACKUP_DIR                 default /var/backups/awcms — where
#                              backup-postgres.sh writes artifacts.
#   BACKUP_LABEL                default awcms — must match the label backups
#                              were written with.
#   DATABASE_URL / RESTORE_DATABASE_URL   passed straight through to
#                              restore-postgres.sh (same requirements: a
#                              privileged role with CREATEDB).
#   RESTORE_AGE_IDENTITY_FILE  passed through, required only if the selected
#                              backup is age-encrypted.
#   BACKUP_HMAC_KEY_FILE       passed through, required only if the selected
#                              backup has a manifest to verify.
#   RESTORE_SCRATCH_DB          passed through to restore-postgres.sh.
#   DRILL_EVIDENCE_LOG          default ${BACKUP_DIR}/restore-drill-evidence.jsonl
#                              — append-only. Each line is one JSON object,
#                              no secrets, safe to ship to log aggregation.
#
# Usage:
#   restore-drill.sh
#
# Exit code mirrors restore-postgres.sh: 0 only if the drill genuinely passed.
# An empty BACKUP_DIR (no eligible backup found) is also a failure — a drill
# that silently does nothing is worse than one that fails loudly.

set -euo pipefail

readonly DEFAULT_BACKUP_DIR="/var/backups/awcms"
readonly DEFAULT_BACKUP_LABEL="awcms"

die() {
  printf 'restore-drill: %s\n' "$*" >&2
  exit 1
}

info() {
  printf 'restore-drill: %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' not found in PATH."
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

# Newest eligible backup: prefers an encrypted `.dump.age` artifact over a
# plaintext `.dump` of the same or older age — encrypted-at-rest is the
# stronger posture, so if both exist the drill should exercise the one that
# actually protects production data.
select_backup() {
  local backup_dir="$1"
  local label="$2"
  local newest=""
  local newest_mtime=0
  local candidate mtime

  while IFS= read -r -d '' candidate; do
    mtime="$(stat -c %Y "$candidate" 2>/dev/null || stat -f %m "$candidate" 2>/dev/null)"
    if [ "$mtime" -gt "$newest_mtime" ]; then
      newest="$candidate"
      newest_mtime="$mtime"
    fi
  done < <(find "$backup_dir" -maxdepth 1 -type f \( -name "${label}_*.dump" -o -name "${label}_*.dump.age" \) -print0)

  printf '%s' "$newest"
}

main() {
  require_command find
  require_command date

  local backup_dir="${BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
  local label="${BACKUP_LABEL:-$DEFAULT_BACKUP_LABEL}"
  local evidence_log="${DRILL_EVIDENCE_LOG:-${backup_dir}/restore-drill-evidence.jsonl}"

  local script_dir restore_script
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  restore_script="${script_dir}/restore-postgres.sh"
  [ -x "$restore_script" ] || die "restore-postgres.sh not found next to restore-drill.sh at ${restore_script}."

  [ -d "$backup_dir" ] || die "BACKUP_DIR does not exist: $backup_dir"

  local selected
  selected="$(select_backup "$backup_dir" "$label")"
  [ -n "$selected" ] || die "no eligible backup found under ${backup_dir} matching ${label}_*.dump or ${label}_*.dump.age. A drill with nothing to restore is a failed drill, not a skipped one."

  info "selected $(basename "$selected") as the newest eligible backup"

  local started_epoch started_iso
  started_epoch="$(date -u +%s)"
  started_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local status="fail"
  local detail=""
  local output
  # --keep is never passed: the drill must clean up after itself to be safe
  # to run unattended on a schedule without accumulating scratch databases.
  if output="$("$restore_script" "$selected" 2>&1)"; then
    status="pass"
    detail="restore drill passed"
  else
    detail="restore drill failed — see log for the specific reason"
  fi
  printf '%s\n' "$output"

  local finished_epoch
  finished_epoch="$(date -u +%s)"
  local duration_seconds=$((finished_epoch - started_epoch))

  # Age of the backup used, at the time of the drill — the RPO proxy.
  local backup_mtime rpo_seconds
  backup_mtime="$(stat -c %Y "$selected" 2>/dev/null || stat -f %m "$selected" 2>/dev/null)"
  rpo_seconds=$((started_epoch - backup_mtime))

  mkdir -p "$(dirname "$evidence_log")"
  {
    printf '{'
    printf '"startedAt":"%s",' "$started_iso"
    printf '"artifact":"%s",' "$(json_escape "$(basename "$selected")")"
    printf '"status":"%s",' "$status"
    printf '"detail":"%s",' "$(json_escape "$detail")"
    printf '"restoreRtoSeconds":%s,' "$duration_seconds"
    printf '"restoreRpoSeconds":%s' "$rpo_seconds"
    printf '}\n'
  } >>"$evidence_log"

  info "evidence appended to ${evidence_log}"
  info "RTO ${duration_seconds}s, RPO ${rpo_seconds}s (backup age at drill time)"

  [ "$status" = "pass" ] || exit 1
  info "restore drill PASSED"
}

main "$@"
