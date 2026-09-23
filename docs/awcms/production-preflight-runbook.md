🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](production-preflight-runbook.id.md)

# Production Preflight — Rehearsal, Apply, and Rollback Runbook

> **Document status (AWCMS, foundation-rebuild phase).** The orchestrator
> this runbook is written around **does not exist here**: there is no
> `scripts/production-preflight.ts`, no `authorizeApply`, and no
> `production:preflight` key in `package.json`. Read every
> "available"/"already running" claim below as a **specification**, not as
> current status.
>
> What IS real, as standalone commands: `config:validate`,
> `security:readiness`, `db:pool:health` (see
> [`production-readiness.md`](production-readiness.md)) and `db:migrate`.
> The gated go/no-go sequence that chains them, plus the
> `database:capacity`, `db:connectivity` and `migration:plan` stages, is
> not built.
>
> `deploy/` is no longer as bare as this banner used to claim. It now holds
> `deploy/backup/backup-postgres.sh`, `deploy/backup/restore-postgres.sh`,
> `deploy/backup/manifest.sh`, `deploy/backup/offsite-copy.sh`,
> `deploy/backup/restore-drill.sh` and `deploy/backup/README.md` (all real,
> and used by §Stage 2 — encryption-at-rest and an authenticated manifest
> **are implemented**, see [ADR-0123](../adr/0123-backup-encryption-manifest-authentication.md)),
> plus `deploy/pgbouncer/pgbouncer.ini.example`, `deploy/redis/docker-compose.yml`
> and `deploy/cron/awcms.crontab`.

Companion to `docs/awcms/07_sprint_testing_production_readiness.md` — this
doc covers the operational procedure around `bun run production:preflight`,
not the checklist itself. See also
[`resilience-dr-verification.md`](resilience-dr-verification.md) for
`bun run resilience:dr-drill` — controlled failure-injection and DR
verification (worker interruption, provider outages, backup/restore/
rollback), a complementary but distinct tool: preflight checks readiness
to migrate/deploy; the DR drill proves recovery behavior actually works
under a controlled failure.

## Why this exists

Before the underlying issue was fixed in the base, `bun run
production:preflight` ran `bun run db:migrate` as an early, unconditional
stage — a later stage failing (spec check, tests, build) still left the
target database migrated, even though the script's own final verdict was
"GO-LIVE DIBLOKIR". A preflight that mutates its target even when it
blocks go-live is not safe to run repeatedly, which defeats the point of a
preflight.

`bun run production:preflight` is **read-only by default**. It runs nine
stages (`config:validate`, `security:readiness`, `database:capacity` —
deployment-aware connection-capacity budget check, see
[`database-capacity-runbook.md`](database-capacity-runbook.md) —
`db:connectivity`, `api:spec:check`, `test`, `build`, `db:pool:health`,
`migration:plan`) and reports a go/no-go verdict — none of them write to
the database. Applying pending migrations is a separate, explicit, gated
action.

## Stage 1 — Rehearsal (only where a second environment exists)

> **This repo has none, and there is no profile for one either.** Per
> [ADR-0083](../adr/0083-this-template-deploys-to-one-environment.md) (as
> amended) the template deploys to exactly one live environment —
> production — and `staging` has been removed from the deployment-profile
> vocabulary itself: the surviving profiles are `development`,
> `production`, and `offline-lan`. This stage therefore describes a
> rehearsal environment somebody chooses to stand up, not a named tier the
> template ships. Its isolation contract lives in
> [`environments.md`](environments.md) §Second-environment isolation contract.
> Here the stage has no target, and what stands in its place is deliberately
> narrower: the CI integration suite against a real PostgreSQL service, plus
> Stage 2's restore-tested backup — which stops being a formality the moment
> nothing rehearses the migration first. That is a mitigation, not an equal
> substitute; ADR-0083 §Consequences records what was given up rather than
> pretending it was free.

Where a rehearsal environment exists, never run `--apply-migrations` against
production without first rehearsing the exact same migrations there, against
a recent copy of production.

1. Restore a recent production backup into it (see §Backup evidence
   below — the same restore path proves both "the backup works" and gives
   you a realistic rehearsal database in one step). That environment owes
   production the full isolation contract: its own database, its own role
   and password, its own secrets, outbound integrations off.
2. Run the read-only preflight against it:
   ```bash
   APP_ENV=production DATABASE_URL=<rehearsal-url> bun run production:preflight
   ```
   Confirm `GO-LIVE DIIZINKAN` and read the `migration:plan` stage's output
   — it lists exactly which migrations are pending, by name.
3. Apply against it:
   ```bash
   APP_ENV=production DATABASE_URL=<rehearsal-url> bun run production:preflight \
     --apply-migrations --backup-verified --acknowledge-target=production
   ```
   `--acknowledge-target` must equal `APP_ENV`, so it cannot distinguish the
   rehearsal database from the real one. What distinguishes them is
   `DATABASE_URL` — read it back before you press enter.
4. Smoke-test it (setup wizard already run / admin login / a
   representative CRUD or posting flow per module touched by the pending
   migrations — e.g. a ledger posting or stock movement once those modules
   exist).
5. Run the full DR drill (see
   [`resilience-dr-verification.md`](resilience-dr-verification.md)) against a
   **throwaway restore of the same backup**, not against the rehearsal
   environment you just ran production rules on:
   ```bash
   APP_ENV=test DATABASE_URL=<throwaway-url> \
   bun run resilience:dr-drill -- --confirm-non-production=test --full
   ```
   That split is forced, not stylistic: the drill's safety interlock gives
   `APP_ENV=production` no override flag at all, so an environment configured
   to exercise production rules can never be its target. Removing `staging`
   removed the one `APP_ENV` value that used to be both production-like and
   drillable; `test` is what is left, and it does not turn production rules
   on. Confirm `overall = pass` — this is the H-7/H-3 backup/restore/rollback
   rehearsal evidence doc 07's go-live plan calls for, produced as a
   reproducible JSON report rather than an ad hoc manual restore.
6. Only proceed to production once that rehearsal is clean. Without a second
   environment — this repo's case — nothing here is skippable in the sense of
   "done elsewhere": Stage 2 becomes the whole of the safety net, so the
   restore test is mandatory rather than advisable.

## Stage 2 — Backup evidence (required before any `--apply-migrations`)

Backup evidence is an operator attestation, not an automated check — you
are attesting to a specific evidence trail, not just remembering a backup
exists somewhere.

> **Update (24 September 2026, [ADR-0123](../adr/0123-backup-encryption-manifest-authentication.md)).**
> Encryption-at-rest (`age`), an authenticated manifest (HMAC-SHA256), an
> off-site copy adapter, and an unattended restore drill are now all
> implemented — see `deploy/backup/README.md` for the full operator guide.
> The plain, unencrypted mode this section previously described (and which
> the offline/LAN profile still uses, having no secret-management story) is
> unchanged and still works exactly as before.

To back up **without** encryption (unchanged — offline/LAN profile default):

```bash
DATABASE_URL=<production-url> \
BACKUP_DIR=/var/backups/awcms \
./deploy/backup/backup-postgres.sh
```

To back up **with** encryption-at-rest and an authenticated manifest
(recommended for any host with a secret-management story):

```bash
DATABASE_URL=<production-url> \
BACKUP_DIR=/var/backups/awcms \
BACKUP_AGE_RECIPIENTS_FILE=/etc/awcms-backup/age-recipients.txt \
BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
./deploy/backup/backup-postgres.sh
```

Both `BACKUP_AGE_RECIPIENTS_FILE` and `BACKUP_HMAC_KEY_FILE` are required
together — setting only one fails closed rather than silently falling back
to plaintext. The result is `<name>.dump.age` plus a
`<name>.dump.age.manifest.json`/`.manifest.json.hmac` pair; the plaintext
dump is deleted once the encrypted artifact is verified on disk.

Then **prove the dump restores** — a dump that was never test-restored is
not verified evidence. `restore-postgres.sh` verifies the manifest (or the
`.sha256` sidecar, for a plain dump) before touching any target database:

```bash
DATABASE_URL=<production-url> \
RESTORE_AGE_IDENTITY_FILE=/etc/awcms-backup/age-identity.key \
BACKUP_HMAC_KEY_FILE=/etc/awcms-backup/hmac.key \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump.age
```

(Defaults to restoring into the disposable `awcms_restore_test`
database — never the live one; `RESTORE_SCRATCH_DB` overrides that name.)
Record the artifact filename, its `sha256` digest, and the restore-test
timestamp somewhere durable (deploy ticket/runbook log) — or rely on
`deploy/backup/restore-drill.sh`, which appends exactly this as one JSON
line to `restore-drill-evidence.jsonl` automatically and is what the
scheduled weekly drill in `deploy/cron/awcms.crontab` now runs.

Off-site copy now has a script behind it:

```bash
OFFSITE_SSH_TARGET=backup-user@second-host:/var/backups/awcms \
OFFSITE_SSH_KEY_FILE=/etc/awcms-backup/offsite-ssh-key \
./deploy/backup/offsite-copy.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump.age \
  /var/backups/awcms/awcms_<db>_<timestamp>.dump.age.sha256 \
  /var/backups/awcms/awcms_<db>_<timestamp>.dump.age.manifest.json \
  /var/backups/awcms/awcms_<db>_<timestamp>.dump.age.manifest.json.hmac
```

It retries with backoff, times out per attempt, and never deletes the local
copy regardless of transfer outcome — that stays a separate, explicit,
human decision.

## Stage 3 — Production preflight (read-only)

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight
```

Read the full report. In particular:

- `db:pool:health` — if this shows `SKIP`, the verdict is **already**
  `GO-LIVE DIBLOKIR` when `APP_ENV=production` (the mandatory-skip rule) —
  start the server (`bun run preview` after `bun run build`) so this stage
  can actually run before proceeding.
- `migration:plan` — the exact list of migrations that would apply. Diff
  this against what you rehearsed in Stage 1; they must match exactly. A
  mismatch (an extra pending migration you didn't rehearse) means stop and
  rehearse it first, not apply blind.

Optionally capture a machine-readable copy of the report for the deploy
record:

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight \
  --json-output=/var/log/awcms/preflight-$(date +%Y%m%d_%H%M%S).json
```

## Stage 4 — Apply (production)

Only after Stage 3 reports `GO-LIVE DIIZINKAN`:

```bash
APP_ENV=production DATABASE_URL=<production-url> bun run production:preflight \
  --apply-migrations --backup-verified --acknowledge-target=production
```

All three flags are required together (`authorizeApply` in
`scripts/production-preflight.ts` refuses otherwise, and refuses
unconditionally if any of the eight read-only stages failed or was
blocked — no flag combination overrides a failed quality gate).
`--acknowledge-target` must match `APP_ENV` **exactly** — this is a
deliberate typo-catcher: running this command in the wrong shell (wrong
`.env` sourced, wrong `APP_ENV`) with the wrong `--acknowledge-target`
value produces a hard refusal, not a silent mutation of the wrong
database.

## Rollback

Migrations in this repo are forward-only (`sql/NNN_*.sql`, no paired
`down` migration). If an applied migration needs to be reversed:

1. **Preferred**: restore the pre-apply backup captured in Stage 2 into a
   fresh database, verify it, then cut traffic over
   (`deploy/backup/restore-postgres.sh ... --target=<production-db>
--yes`, after confirming the target name matches intentionally — this
   is a genuinely destructive `pg_restore --clean --if-exists`, only ever
   run against a database you mean to overwrite).
2. **If the migration is additive and provably safe to leave in place**
   (e.g. a new nullable column, a new table nothing references yet): leave
   the schema change applied and instead revert the application code that
   depends on it, via a normal deploy rollback (previous release
   artifact/image). Only choose this path when you have verified the
   migration made no destructive change (no dropped column, no data
   rewrite) — when in doubt, restore instead. For ERP data specifically
   (posted ledger entries, payroll runs, stock movements), prefer restore
   over "leave applied" whenever there is any doubt, given the higher cost
   of a financial-data mistake.
3. Record what happened (which path taken, why, evidence) in the same
   place Stage 2's backup evidence was recorded.

## Evidence retention

Keep, per production apply: the backup dump + checksum (per
`BACKUP_RETENTION_DAYS` in `deploy/backup/backup-postgres.sh`), the
restore-test confirmation, the `--json-output` preflight report, and a
one-line record of the rollback decision if the apply was ever reversed.
For ERP financial/payroll modules, evidence retention should also account
for statutory/tax retention periods (see
[`data-lifecycle.md`](data-lifecycle.md)) rather than only operational
convenience.
</content>
