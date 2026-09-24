#!/usr/bin/env bash
#
# manifest.sh — generate and verify the authenticated manifest that binds a
# backup artifact (plaintext `.dump` or `age`-encrypted `.dump.age`) to the
# recovery metadata needed to trust and restore it.
#
# Shared by backup-postgres.sh (generate) and restore-postgres.sh (verify).
# Unlike the URL parser duplicated across those two scripts (each has to be
# copyable to a host on its own), this file holds the one piece of logic that
# is genuinely worth NOT duplicating: HMAC key handling. Both callers live in
# the same deploy/backup/ directory and are always deployed together, so this
# is copied alongside them, not "shared" across a wider surface.
#
# See docs/adr/0123-backup-encryption-manifest-authentication.md for why this
# is HMAC-SHA256 (not a detached signature) and why the key is read via Perl
# reading files directly rather than via `openssl dgst -hmac <key>`: the
# latter puts the raw key on argv, visible to every user on the host via
# `ps`, for as long as the process runs. Perl's core `Digest::SHA` module
# reads both the key and the message from files opened in the script, so the
# key bytes never appear as a command-line argument anywhere.
#
# ## Manifest format
#
# A deterministic, hand-built JSON object (one field per line, fixed order —
# never minified, never produced by a library that could reorder fields
# between versions) so the bytes HMAC'd are exactly the bytes on disk and
# extraction on verify can use plain `sed`, no JSON parser required:
#
#   {
#     "manifest_version": "1",
#     "artifact_filename": "awcms_db_20260924_120000Z.dump.age",
#     "artifact_sha256": "<hex>",
#     "artifact_size_bytes": "12345",
#     "source_database": "awcms_812_test",
#     "created_at": "2026-09-24T12:00:00Z",
#     "pg_dump_version": "pg_dump (PostgreSQL) 18.4",
#     "recipients_sha256": "<hex, empty string if unencrypted>"
#   }
#
# The manifest's own bytes are HMAC'd; the digest is written as a sibling
# `<manifest>.hmac` file containing exactly the lowercase hex digest and a
# trailing newline.

set -euo pipefail

die() {
  printf 'manifest: %s\n' "$*" >&2
  exit 1
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

# Reads the key from $1 and the message from $2, both as file paths — never
# as literal argv values — and prints the lowercase hex HMAC-SHA256 digest.
hmac_sha256_file() {
  local key_file="$1"
  local data_file="$2"
  perl -MDigest::SHA=hmac_sha256_hex -e '
    my ($key_path, $data_path) = @ARGV;
    open(my $kf, "<:raw", $key_path) or die "manifest: cannot open HMAC key file: $!\n";
    local $/;
    my $key = <$kf>;
    close $kf;
    open(my $df, "<:raw", $data_path) or die "manifest: cannot open data file: $!\n";
    my $data = <$df>;
    close $df;
    print hmac_sha256_hex($data, $key), "\n";
  ' "$key_file" "$data_file"
}

sha256_file() {
  sha256sum "$1" | cut -d' ' -f1
}

cmd_generate() {
  local artifact="" hmac_key_file="" source_db="" pg_dump_version="" recipients_file="" out=""

  local arg
  for arg in "$@"; do
    case "$arg" in
      --artifact=*) artifact="${arg#--artifact=}" ;;
      --hmac-key-file=*) hmac_key_file="${arg#--hmac-key-file=}" ;;
      --source-db=*) source_db="${arg#--source-db=}" ;;
      --pg-dump-version=*) pg_dump_version="${arg#--pg-dump-version=}" ;;
      --recipients-file=*) recipients_file="${arg#--recipients-file=}" ;;
      --out=*) out="${arg#--out=}" ;;
      *) die "generate: unknown option: $arg" ;;
    esac
  done

  [ -n "$artifact" ] || die "generate: --artifact is required"
  [ -f "$artifact" ] || die "generate: artifact not found: $artifact"
  [ -n "$hmac_key_file" ] || die "generate: --hmac-key-file is required"
  [ -f "$hmac_key_file" ] || die "generate: HMAC key file not found: $hmac_key_file"
  [ -n "$out" ] || die "generate: --out is required"

  require_command perl
  require_command sha256sum

  local artifact_filename artifact_sha256 artifact_size recipients_sha256 created_at
  artifact_filename="$(basename "$artifact")"
  artifact_sha256="$(sha256_file "$artifact")"
  artifact_size="$(wc -c <"$artifact" | tr -d ' ')"
  created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  recipients_sha256=""
  if [ -n "$recipients_file" ]; then
    [ -f "$recipients_file" ] || die "generate: --recipients-file not found: $recipients_file"
    recipients_sha256="$(sha256_file "$recipients_file")"
  fi

  # Write to a .partial path and rename, same discipline as the dump itself:
  # a manifest that is half-written must not be mistaken for a real one.
  local out_partial="${out}.partial"
  {
    printf '{\n'
    printf '  "manifest_version": "1",\n'
    printf '  "artifact_filename": "%s",\n' "$(json_escape "$artifact_filename")"
    printf '  "artifact_sha256": "%s",\n' "$artifact_sha256"
    printf '  "artifact_size_bytes": "%s",\n' "$artifact_size"
    printf '  "source_database": "%s",\n' "$(json_escape "$source_db")"
    printf '  "created_at": "%s",\n' "$created_at"
    printf '  "pg_dump_version": "%s",\n' "$(json_escape "$pg_dump_version")"
    printf '  "recipients_sha256": "%s"\n' "$recipients_sha256"
    printf '}\n'
  } >"$out_partial"
  mv -- "$out_partial" "$out"

  local hmac_partial="${out}.hmac.partial"
  hmac_sha256_file "$hmac_key_file" "$out" >"$hmac_partial"
  mv -- "$hmac_partial" "${out}.hmac"

  printf 'manifest: wrote %s and %s.hmac\n' "$out" "$out" >&2
}

extract_field() {
  local manifest="$1"
  local field="$2"
  sed -n "s/^  \"${field}\": \"\\(.*\\)\",\\{0,1\\}\$/\\1/p" "$manifest" | head -n1
}

cmd_verify() {
  local manifest="" hmac_key_file="" artifact=""

  local arg
  for arg in "$@"; do
    case "$arg" in
      --manifest=*) manifest="${arg#--manifest=}" ;;
      --hmac-key-file=*) hmac_key_file="${arg#--hmac-key-file=}" ;;
      --artifact=*) artifact="${arg#--artifact=}" ;;
      *) die "verify: unknown option: $arg" ;;
    esac
  done

  [ -n "$manifest" ] || die "verify: --manifest is required"
  [ -f "$manifest" ] || die "verify: manifest not found: $manifest"
  [ -f "${manifest}.hmac" ] || die "verify: ${manifest}.hmac not found — manifest is not authenticated, refusing to trust it"
  [ -n "$hmac_key_file" ] || die "verify: --hmac-key-file is required"
  [ -f "$hmac_key_file" ] || die "verify: HMAC key file not found: $hmac_key_file"
  [ -n "$artifact" ] || die "verify: --artifact is required"
  [ -f "$artifact" ] || die "verify: artifact not found: $artifact"

  require_command perl
  require_command sha256sum

  local expected_hmac actual_hmac
  expected_hmac="$(tr -d '[:space:]' <"${manifest}.hmac")"
  actual_hmac="$(hmac_sha256_file "$hmac_key_file" "$manifest")"

  # Constant-time-ish compare is not the point here (both values are already
  # on disk, this is not a network timing oracle); correctness is.
  [ "$expected_hmac" = "$actual_hmac" ] ||
    die "TAMPER DETECTED: manifest HMAC does not match. Either the manifest was modified after signing, or the wrong --hmac-key-file was given. Refusing to trust ${manifest} — no restore mutation has happened."

  local expected_filename actual_filename expected_sha256 actual_sha256
  expected_filename="$(extract_field "$manifest" artifact_filename)"
  actual_filename="$(basename "$artifact")"
  [ -n "$expected_filename" ] || die "verify: manifest has no artifact_filename field."
  [ "$expected_filename" = "$actual_filename" ] ||
    die "TAMPER DETECTED: manifest names artifact '${expected_filename}' but was asked to verify '${actual_filename}'. Refusing to trust this pairing."

  expected_sha256="$(extract_field "$manifest" artifact_sha256)"
  [ -n "$expected_sha256" ] || die "verify: manifest has no artifact_sha256 field."
  actual_sha256="$(sha256_file "$artifact")"
  [ "$expected_sha256" = "$actual_sha256" ] ||
    die "TAMPER DETECTED: artifact ${artifact} does not match the sha256 digest bound in its authenticated manifest (expected ${expected_sha256}, got ${actual_sha256}). This is either corruption or a replaced/tampered artifact — refusing to restore it."

  printf 'manifest: verified — HMAC valid, filename matches, digest matches\n' >&2

  # Machine-readable output for the caller, deliberately NOT eval'd by us —
  # the caller decides whether/how to consume it.
  printf 'SOURCE_DATABASE=%s\n' "$(extract_field "$manifest" source_database)"
  printf 'CREATED_AT=%s\n' "$(extract_field "$manifest" created_at)"
  printf 'PG_DUMP_VERSION=%s\n' "$(extract_field "$manifest" pg_dump_version)"
}

usage() {
  cat <<'USAGE'
Usage:
  manifest.sh generate --artifact=<path> --hmac-key-file=<path> --out=<manifest-path> \
                        [--source-db=<name>] [--pg-dump-version=<str>] [--recipients-file=<path>]
  manifest.sh verify   --manifest=<path> --hmac-key-file=<path> --artifact=<path>
USAGE
}

main() {
  local sub="${1-}"
  [ -n "$sub" ] || { usage >&2; exit 1; }
  shift
  case "$sub" in
    generate) cmd_generate "$@" ;;
    verify) cmd_verify "$@" ;;
    --help | -h) usage ;;
    *) die "unknown subcommand: $sub" ;;
  esac
}

main "$@"
