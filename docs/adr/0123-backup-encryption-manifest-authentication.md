🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0123-backup-encryption-manifest-authentication.id.md)

# ADR-0123 — Backup encryption, authenticated manifests, off-site copy, and restore-drill automation

- **Status:** Accepted
- **Date:** 2026-09-24
- **Decision maker:** ahliweb
- **Related:** Issue #812; `deploy/backup/backup-postgres.sh`; `deploy/backup/restore-postgres.sh`; `deploy/backup/manifest.sh`; `deploy/backup/offsite-copy.sh`; `deploy/backup/restore-drill.sh`; `docs/awcms/production-preflight-runbook.md` §Stage 2; `docs/awcms/deployment-profiles.md`

## Context

`deploy/backup/backup-postgres.sh` and `deploy/backup/restore-postgres.sh`
(landed earlier as a strong baseline) deliberately refuse to run when
`BACKUP_ENCRYPTION_KEY_FILE` or `BACKUP_HMAC_KEY_FILE` is set, because
encryption-at-rest and an authenticated manifest were never implemented.
`docs/awcms/production-preflight-runbook.md` §Stage 2 and
`docs/awcms/deployment-profiles.md` both carry a dated correction saying so.
This ADR closes that gap: it records the options considered for encryption
at rest and manifest authentication, the decision, and what was built.

AWCMS is Bun-only for application code (AGENTS.md rule 11), but
`deploy/backup/*.sh` already runs as plain Bash inside a `postgres:18.4`
container that has no Bun (see the header comment in both existing
scripts) — it wraps `pg_dump`/`pg_restore`, OS-level binaries, not
application logic. The same constraint applies to whatever this ADR adds:
it must run unattended, without a human at a terminal, inside that same
minimal container image (or one very close to it), and it must not pull in
Node.js/npm tooling.

## Options considered — encryption at rest

| Option                                              | Advantages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Disadvantages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`age`** (`filippo.io/age`, FiloSottile)           | Single static Go binary, no config file, no keyring, no daemon. Modern AEAD construction (X25519 + ChaCha20-Poly1305, or scrypt for passphrases). Recipients are public keys — the encrypting host only ever needs a **public** key file, never the private identity that can decrypt. Already vendored on this machine's operator tooling (`age`/`age-keygen` present in `PATH` during this work) and it is a single ~5 MB binary trivial to add to the backup container image via `COPY --from=ghcr.io/...` or a pinned release download, with no package-manager dependency chain. | Not in Debian/Ubuntu's default `postgres:18.4` base image — must be added to whatever image runs the backup (documented, one `COPY` line). Younger project than GnuPG (first release 2019) though widely adopted (used by `sops`, `github.com/FiloSottile/age`, Mozilla SOPS, 1Password, Tailscale).                                                                                                                                                                                                                   |
| **GnuPG (`gpg --encrypt`)**                         | Ubiquitous, present in most base images already, very mature, FIPS-adjacent deployments sometimes require it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Notoriously bad unattended UX (keyring/agent state, `gpg-agent` daemon, `pinentry` prompts unless carefully suppressed), a much larger attack surface (CVE history includes parser and side-channel issues), key management is heavier (keyring files, trust database) for something that only needs "encrypt to one recipient, decrypt with one identity" — GnuPG solves a much bigger problem (web of trust, multi-recipient signing chains) than this use case has.                                                 |
| **OpenSSL `enc`** (e.g. `openssl enc -aes-256-cbc`) | Present in every image with OpenSSL (already a dependency of `psql`/`libpq`'s TLS support). No new binary to add.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `openssl enc` is explicitly documented by upstream as **not authenticated** (no AEAD, no integrity check baked in) — the classic "TLS certificate padding oracle"-adjacent history of `openssl enc` misuse is well known; using it correctly requires bolting on a separate MAC (which is exactly what `age`/GnuPG already do internally, correctly, and audited). Using OpenSSL here would mean re-implementing authenticated encryption by hand, which is the class of mistake this ADR exists to avoid.             |
| **libsodium / Bun-native `node:crypto`**            | Best-in-class primitives (`crypto_secretbox`, AES-256-GCM), and Bun ships `node:crypto` compatibility so no new dependency for a Bun _script_.                                                                                                                                                                                                                                                                                                                                                                                                                                        | The backup/restore scripts are explicitly plain Bash run inside a Bun-less `postgres:18.4` container (see both scripts' header comments) — introducing a Bun/Node step into that path means either (a) adding Bun to the backup image (defeats the "minimal, version-matched to the server" design already chosen for `pg_dump`/`pg_restore`), or (b) writing custom C/Rust FFI glue outside Bash, which is exactly the "small composable scripts" the issue explicitly asks to avoid replacing with something opaque. |

**Decision: `age`.** It is the only option that is simultaneously (a) a
single static binary trivial to add to an unattended container image,
(b) authenticated encryption by construction (no hand-rolled MAC), and
(c) asymmetric — the backup-producing host only ever needs a _public_
recipients file, so a compromised backup host cannot decrypt its own
backups, and the private identity that can decrypt lives only where
restores/drills run. GnuPG was rejected primarily for unattended-operation
fragility (agent/pinentry state) and unnecessary complexity for a
one-recipient use case; OpenSSL `enc` was rejected for not being
authenticated encryption; Bun-native crypto was rejected because it would
require adding a Bun runtime to a container deliberately kept minimal and
version-matched to the PostgreSQL server, or reimplementing crypto glue in
Bash via FFI, either of which is worse than a single vetted binary call.

## Options considered — manifest authentication

| Option                                                                         | Advantages                                                                                                                                                                                                                                                                                                | Disadvantages                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HMAC-SHA256 over a canonical JSON manifest, key from a key file**            | Symmetric, single OpenSSL/`sha256sum`-adjacent primitive (`openssl dgst -sha256 -hmac`), no new binary (OpenSSL is already present), trivial to verify with one command, matches the project's existing sync-HMAC pattern (`docs/awcms/sync-hmac.md`) so operators and reviewers already know this shape. | Symmetric key: whoever can verify can also forge. Acceptable here because verification only happens on hosts that are themselves trusted to run a restore (restore-drill / restore-postgres already require privileged DB credentials) — the manifest's job is tamper-_detection_ against a compromised or corrupted **storage/transport** layer, not against a host that already holds restore credentials.                     |
| **Detached age-based signature** (`age` has no native signing) or **minisign** | Asymmetric — a compromised restore host could verify but not forge.                                                                                                                                                                                                                                       | `age` has no built-in signing primitive; adding minisign means a _second_ static binary (on top of `age`) with far less ecosystem adoption in this codebase, for a threat (a compromised restore/drill host forging its own manifest) that is not the threat this control targets — a host that can already run `pg_restore` against production credentials can already do arbitrary damage regardless of manifest authenticity. |
| **GPG detached signature (`gpg --detach-sign`)**                               | Asymmetric, ubiquitous format.                                                                                                                                                                                                                                                                            | Same unattended-operation fragility as the encryption option above, and pulls in the whole GnuPG keyring/trust-database machinery for one detached signature.                                                                                                                                                                                                                                                                    |

**Decision: HMAC-SHA256 with a key file**, consistent with the existing
`SYNC_HMAC_KEY`/sync-HMAC pattern already documented in this repo
(`docs/awcms/sync-hmac.md`) so the operational shape (key file, `openssl
dgst -sha256 -hmac`, fail-closed on partial config) is one the team
already knows and audits. The manifest itself uses a canonical,
field-ordered JSON body so the HMAC is computed over stable bytes, not an
implementation-dependent serialization.

## Decision

1. **`age`** (asymmetric, X25519) encrypts the backup artifact.
   `BACKUP_AGE_RECIPIENTS_FILE` (one or more `age1...` public recipient
   lines, safe to keep on the backup-producing host) is used to encrypt;
   `RESTORE_AGE_IDENTITY_FILE` (the `AGE-SECRET-KEY-1...` private
   identity, kept only where restores/drills run) is used to decrypt.
   Splitting the two env var names (rather than reusing
   `BACKUP_ENCRYPTION_KEY_FILE` for both directions) makes the asymmetry
   visible in configuration, not just in the underlying primitive.
2. **HMAC-SHA256** (`BACKUP_HMAC_KEY_FILE`, a 32+ byte raw key file, present
   on both backup and restore hosts) authenticates a canonical JSON
   manifest binding: artifact filename, artifact sha256 digest,
   `pg_dump`/server version metadata, source database name, backup
   timestamp, and the age recipients fingerprint used. The manifest is
   verified **before decryption and before any restore mutation**.
3. Both new env vars are **all-or-nothing per direction**: if exactly one
   of `BACKUP_AGE_RECIPIENTS_FILE`/`BACKUP_HMAC_KEY_FILE` is set at backup
   time, or exactly one of `RESTORE_AGE_IDENTITY_FILE`/
   `BACKUP_HMAC_KEY_FILE` is set at restore time, the script fails closed
   with a clear error rather than silently falling back to plaintext or
   skipping verification. When _neither_ is set, behavior is unchanged
   from before this ADR (plain `--format=custom` dump + sha256 sidecar) —
   the offline/LAN deployment profile, which has no secret-management
   story, keeps working exactly as it does today.
4. **Off-site copy** (`deploy/backup/offsite-copy.sh`) is a thin adapter
   around `rsync`/`scp`-over-SSH (already present in any image with an
   `ssh` client, no new dependency) with retry/backoff, a timeout per
   attempt, and — critically — it **never deletes the local artifact**,
   regardless of transfer outcome; deleting local backups is a separate,
   explicit, human decision this script does not make.
5. **Restore drill automation** (`deploy/backup/restore-drill.sh`) is a
   thin orchestrator: pick the newest eligible local backup, verify its
   manifest, decrypt if needed, hand it to the existing
   `restore-postgres.sh` in its default **non-destructive drill mode**
   (no `--target`, so it is structurally incapable of targeting
   production — there is no flag path in this script that ever passes
   `--target`), and append one JSON line of evidence (dump name, digest,
   RTO seconds, pass/fail, timestamp — no secrets) to an evidence log.
   Cron-schedulable (`deploy/cron/awcms.crontab` already runs the
   pre-ADR equivalent weekly); this ADR keeps that entry pointed at the
   new script instead of calling `restore-postgres.sh` directly.

## Rejected scope

- **`scripts/dr-drill.ts` / `bun run resilience:dr-drill`** — described in
  `docs/awcms/resilience-dr-verification.md` as a not-yet-built
  orchestrator that would eventually call a `restore-drill.sh`. That
  document's own banner says the tool does not exist in this repo yet;
  building the whole failure-injection framework (`target-guard.ts`,
  scenario runner, six scenario definitions) is out of scope for this
  issue, which is specifically the backup/restore assurance gap. This ADR
  ships `deploy/backup/restore-drill.sh` as a real, standalone,
  cron/CI-capable script that `dr-drill.ts` can call **when it is built**
  — it does not block on that larger effort, and the doc's banner is left
  in place (still true) rather than rewritten to claim a tool exists.
- **A dedicated secrets-management integration** (Vault, AWS Secrets
  Manager, etc.) — out of scope. The contract is "keys come from files",
  which composes with any secret manager that can materialize a file
  (Docker/Kubernetes secrets, Vault Agent template, etc.) without this
  repo taking a dependency on any specific one.

## Consequences

- Positive: production backups can be confidentiality- and
  integrity-protected without adding a Bun/Node dependency to the backup
  container, using widely-audited primitives, while the offline/LAN
  profile's no-encryption default keeps working unchanged.
- Positive: the asymmetric split (recipients file vs. identity file) means
  a compromised backup-producing host cannot decrypt the backups it wrote,
  which materially reduces the blast radius of that specific compromise.
- Negative: operators now manage one more key pair (`age`) and one more
  shared secret (HMAC key), on top of the DB credential itself, with the
  operational discipline that implies (rotation, storage, never committing
  them — enforced by `.gitignore`-style guidance in
  `deploy/backup/README.md`, not by tooling, since these are host-level
  secret files outside this repository's own knowledge).
- Negative: the backup image must now include the `age` binary; this is a
  single static binary addition, documented in
  `deploy/backup/README.md`, not a package-manager dependency chain.

## Standards alignment

This satisfies the confidentiality (encryption at rest), integrity
(authenticated manifest, tamper detection), and tested-recoverability
(restore drill with evidence) controls commonly expected by ISO/IEC
27001/27002 backup-management controls and ISO 22301 business-continuity
practice, without claiming certification to either.
