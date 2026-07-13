# Production Preflight — Rehearsal, Apply, and Rollback Runbook

> **Status dokumen (AWCMS).** `bun run production:preflight` dan seluruh
> prosedur di bawah adalah mekanisme generik yang diwarisi dari base teknis
> `awcms-mini` (Issue #684 di repo asal, epic `platform-hardening`) — sudah
> tersedia sejak fondasi AWCMS, terlepas dari modul ERP mana yang aktif.
> Yang **belum pernah dijalankan** di AWCMS adalah rehearsal/apply
> sungguhan terhadap migrasi domain ERP nyata (belum ada modul finance/
> inventory/procurement/manufacturing/HR-payroll) — prosedur di bawah
> berlaku sebagai standar wajib begitu migrasi modul pertama siap di-apply.

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

## Stage 1 — Rehearsal (staging, always first)

Never run `--apply-migrations` against production without first rehearsing
the exact same migrations against a staging environment that is a recent
copy of production.

1. Restore a recent production backup into staging (see §Backup evidence
   below — the same restore path proves both "the backup works" and gives
   you a realistic staging database in one step).
2. Run the read-only preflight against staging:
   ```bash
   APP_ENV=staging DATABASE_URL=<staging-url> bun run production:preflight
   ```
   Confirm `GO-LIVE DIIZINKAN` and read the `migration:plan` stage's output
   — it lists exactly which migrations are pending, by name.
3. Apply against staging:
   ```bash
   APP_ENV=staging DATABASE_URL=<staging-url> bun run production:preflight \
     --apply-migrations --backup-verified --acknowledge-target=staging
   ```
4. Smoke-test staging (setup wizard already run / admin login / a
   representative CRUD or posting flow per module touched by the pending
   migrations — e.g. a ledger posting or stock movement once those modules
   exist).
5. Run the full DR drill against the SAME staging environment (see
   [`resilience-dr-verification.md`](resilience-dr-verification.md)):
   ```bash
   APP_ENV=staging DATABASE_URL=<staging-url> \
   bun run resilience:dr-drill -- --confirm-non-production=staging --full
   ```
   Confirm `overall = pass` — this is the H-7/H-3 backup/restore/rollback
   rehearsal evidence doc 07's go-live plan calls for, produced as a
   reproducible JSON report rather than an ad hoc manual restore.
6. Only proceed to production once staging rehearsal is clean.

## Stage 2 — Backup evidence (required before any `--apply-migrations`)

`--backup-verified` is a flag, not an automated check — the operator is
attesting to a specific evidence trail, not just remembering a backup
exists somewhere. The backup is encrypted and manifest-signed and the
restore verifies checksums before any mutation — see
`deploy/backup/README.md` for the full model. Before passing
`--backup-verified`:

```bash
DATABASE_URL=<production-url> \
BACKUP_DIR=/var/backups/awcms \
BACKUP_ENCRYPTION_KEY_FILE=/etc/awcms/backup-encryption.key \
BACKUP_HMAC_KEY_FILE=/etc/awcms/backup-hmac.key \
./deploy/backup/backup-postgres.sh
```

Then **prove the dump restores** (a dump that was never test-restored is
not verified evidence — this is the same principle
`deploy/backup/README.md` and doc 07's restore SOP already establish).
`restore-postgres.sh` itself verifies the manifest's HMAC and the dump's
checksum, and validates the decrypted archive's structure with
`pg_restore --list`, before touching any target database:

```bash
DATABASE_URL=<production-url> \
BACKUP_ENCRYPTION_KEY_FILE=/etc/awcms/backup-encryption.key \
BACKUP_HMAC_KEY_FILE=/etc/awcms/backup-hmac.key \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<timestamp>.dump.enc
```

(Defaults to restoring into the disposable `awcms_restore_test`
database — never the live one.) Record the dump filename, its manifest's
`sha256`/`hmac_sha256`, and the restore-test timestamp somewhere durable
(deploy ticket/runbook log) — this is the "evidence retention" this
runbook asks for.

Off-site copy (`deploy/backup/offsite-copy.sh`) is optional and, if
configured, runs as a separate step after `backup-postgres.sh` — see
`deploy/backup/README.md`'s "3-2-1" section. It is not part of the
`--backup-verified` evidence trail itself (the restore-test is what
proves the backup is usable; off-site copy is about surviving loss of the
backup host).

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
