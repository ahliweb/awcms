# AWCMS backup & restore — operator guide

Small composable scripts, not one opaque wrapper — each one is independently
readable and runnable. See
[ADR-0123](../../docs/adr/0123-backup-encryption-manifest-authentication.md)
for why encryption is `age`, why the manifest is HMAC-SHA256, and what was
rejected. Every script is plain Bash (AGENTS.md rule 11 exempts OS-level
`pg_dump`/`pg_restore` wrappers — see each script's own header comment) and
runs inside a `postgres:18.4`-based image, version-matched to the server.

| Script                | Job                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup-postgres.sh`  | Dump the database. Optionally encrypt + generate an authenticated manifest.                                                                                                                  |
| `restore-postgres.sh` | Verify (+ decrypt) a backup, then restore it — drill mode by default, destructive only with `--target` + confirmation.                                                                       |
| `manifest.sh`         | Generate/verify the authenticated recovery manifest. Called by the two scripts above; rarely invoked directly.                                                                               |
| `offsite-copy.sh`     | Copy verified backup artifacts to a second host over SSH/rsync, with retries. Never deletes the local copy.                                                                                  |
| `restore-drill.sh`    | Unattended orchestrator: pick the newest eligible backup, drill-restore it, append evidence. Cron/CI-capable. Structurally cannot target production — there is no `--target` anywhere in it. |

## Quick start — no encryption (offline/LAN profile, or any host with no secret-management story)

```bash
DATABASE_URL=<owner-role-url> BACKUP_DIR=/var/backups/awcms ./backup-postgres.sh
DATABASE_URL=<owner-role-url> ./restore-postgres.sh /var/backups/awcms/awcms_<db>_<ts>.dump
```

Unchanged from before ADR-0123: a plain `--format=custom` dump plus a
`.sha256` sidecar.

## Quick start — encrypted, authenticated, off-site

1. Generate the key material once, on a workstation you trust, not on the
   backup host itself:

   ```bash
   age-keygen -o age-identity.key           # keep this OFF the backup host
   grep '^# public key:' age-identity.key | sed 's/# public key: //' > age-recipients.txt
   openssl rand -out hmac.key 32
   ```

   Distribute `age-recipients.txt` (public, safe on the backup host) and
   `hmac.key` (secret, needed on BOTH backup and restore hosts, e.g. via
   Docker/Kubernetes secrets or your secret manager's file-materialization
   feature) to the backup host. Keep `age-identity.key` (the private
   identity) ONLY where restores/drills run — never on the host that
   produces backups. That asymmetry is the point: a compromised backup host
   cannot decrypt its own backups.

2. Back up, encrypted:

   ```bash
   DATABASE_URL=<owner-role-url> \
   BACKUP_DIR=/var/backups/awcms \
   BACKUP_AGE_RECIPIENTS_FILE=/etc/awcms-backup/age-recipients.txt \
   BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
   ./backup-postgres.sh
   ```

   Produces `<name>.dump.age` + `<name>.dump.age.sha256` +
   `<name>.dump.age.manifest.json` + `<name>.dump.age.manifest.json.hmac`.
   The plaintext dump is deleted once the encrypted artifact is verified on
   disk — nothing readable is ever left behind.

   Setting only one of `BACKUP_AGE_RECIPIENTS_FILE`/`BACKUP_HMAC_KEY_FILE`
   fails closed with a clear error instead of silently writing a plaintext
   dump.

3. Copy off-site:

   ```bash
   OFFSITE_SSH_TARGET=backup-user@second-host:/var/backups/awcms \
   OFFSITE_SSH_KEY_FILE=/etc/awcms-backup/offsite-ssh-key \
   ./offsite-copy.sh /var/backups/awcms/awcms_<db>_<ts>.dump.age \
     /var/backups/awcms/awcms_<db>_<ts>.dump.age.sha256 \
     /var/backups/awcms/awcms_<db>_<ts>.dump.age.manifest.json \
     /var/backups/awcms/awcms_<db>_<ts>.dump.age.manifest.json.hmac
   ```

4. Restore (drill, non-destructive, the default):

   ```bash
   DATABASE_URL=<owner-role-url> \
   RESTORE_AGE_IDENTITY_FILE=/etc/awcms-backup/age-identity.key \
   BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
   ./restore-postgres.sh /var/backups/awcms/awcms_<db>_<ts>.dump.age
   ```

   Or run the whole selection + drill + evidence flow unattended:

   ```bash
   DATABASE_URL=<owner-role-url> \
   BACKUP_DIR=/var/backups/awcms \
   RESTORE_AGE_IDENTITY_FILE=/etc/awcms-backup/age-identity.key \
   BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
   ./restore-drill.sh
   ```

5. Restore into a real target (destructive — read the confirmation prompt):

   ```bash
   DATABASE_URL=<owner-role-url> \
   RESTORE_AGE_IDENTITY_FILE=/etc/awcms-backup/age-identity.key \
   BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
   ./restore-postgres.sh /var/backups/awcms/awcms_<db>_<ts>.dump.age --target=<dbname> --yes
   ```

## What "authenticated" actually buys you

- **Tampering with the ciphertext** — `age`'s AEAD construction fails to
  decrypt (see `restore-postgres.sh`'s `decrypt_and_verify`).
- **Replacing the artifact with a different (also valid) encrypted file** —
  the manifest's `artifact_sha256`/`artifact_filename` won't match; caught
  BEFORE decryption is even attempted.
- **Tampering with the manifest itself** (e.g. changing which database it
  claims to be, to trick an operator into restoring the wrong evidence) —
  the HMAC over the manifest bytes won't verify.
- All three are proven in this PR's test run: a byte flipped in the
  ciphertext, and a field edited in the manifest, each independently caused
  `restore-postgres.sh` to refuse BEFORE any database mutation.

## Fail-closed configuration

Both directions require their two env vars together:

- Backup: `BACKUP_AGE_RECIPIENTS_FILE` + `BACKUP_HMAC_KEY_FILE`, or neither.
- Restore: `RESTORE_AGE_IDENTITY_FILE` + `BACKUP_HMAC_KEY_FILE`, or neither
  (only reachable when restoring a `.dump.age` file at all — a plain
  `.dump` never needs them).

Setting exactly one is refused with a specific error naming which variable
is missing, never a silent fallback.

## Secrets — what goes where, and what never appears in a log

| Secret                          | Lives on                       | Never appears                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` (incl. password) | env var only                   | Never on argv (parsed via `export_libpq_env_from_url` into `PGPASSWORD` etc.), never printed.                                                                                                                                                                                                     |
| `age` recipients file (public)  | backup host                    | N/A — not a secret.                                                                                                                                                                                                                                                                               |
| `age` identity file (private)   | restore/drill hosts ONLY       | Never on argv; read directly by `age -i <path>`.                                                                                                                                                                                                                                                  |
| HMAC key file                   | backup AND restore/drill hosts | Never on argv. Read by `manifest.sh` via a Perl one-liner that opens the key file directly (`Digest::SHA::hmac_sha256_hex`) — this is deliberate: `openssl dgst -hmac <key>` would put the raw key on the command line, visible to any user on the host via `ps` for as long as the process runs. |

Base images ship neither `age` nor a database client by default; add `age`
to whatever image runs these scripts (a single static binary — see
ADR-0123's Dockerfile note) and use a PostgreSQL client image version-matched
to the server for `pg_dump`/`pg_restore`, exactly as the existing scripts'
header comments already describe for the Coolify one-shot-container pattern.

## Key management (this repo's responsibility ends here)

Key rotation, storage, and access control for `age-identity.key`/
`age-recipients.txt`/`hmac.key` are host-level operational concerns, not
something this repo's tooling manages — they compose with whatever secret
manager can materialize a file (Docker/Kubernetes secret, Vault Agent
template, etc.). Never commit any of the three files to this or any
repository.

## Retention

`BACKUP_RETENTION_DAYS` (default 14, `0` disables) on `backup-postgres.sh`
prunes both plain and encrypted backups (and their sidecars/manifests)
locally. Off-site retention is whatever policy the destination in
`OFFSITE_SSH_TARGET` applies — `offsite-copy.sh` only copies, it never
prunes the destination.

## RPO/RTO and retention as configurable policy, not one organization's numbers

This repo ships no hard-coded RPO/RTO target or retention policy — those are
organizational decisions. What it gives you are the knobs and the evidence:

- **RPO** — governed by how often `backup-postgres.sh` runs (cron cadence)
  and `BACKUP_RETENTION_DAYS`. `restore-drill.sh` reports the actual age of
  the backup it drilled (`restoreRpoSeconds`) as evidence of what your RPO
  really is in practice, not just what the cron schedule intends.
- **RTO** — `restore-drill.sh` reports `restoreRtoSeconds`, the real
  wall-clock duration of a full verify→decrypt→restore→check cycle, as
  evidence for how long an actual recovery takes.
- **Evidence** — every drill run appends one line to
  `${BACKUP_DIR}/restore-drill-evidence.jsonl` (override with
  `DRILL_EVIDENCE_LOG`): timestamp, artifact name, pass/fail, RTO, RPO. No
  secrets, no PII, no database contents — safe to ship to log aggregation
  or attach to a change-management ticket as recovery evidence.
