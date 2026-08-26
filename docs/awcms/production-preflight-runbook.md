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
> `deploy/backup/backup-postgres.sh` and `deploy/backup/restore-postgres.sh`
> (real, and used by §Stage 2), `deploy/pgbouncer/pgbouncer.ini.example`,
> `deploy/redis/docker-compose.yml` and `deploy/cron/awcms.crontab`. There
> is no `deploy/backup/README.md` and no `offsite-copy.sh`, and the two
> backup scripts implement **neither encryption nor HMAC manifests** —
> §Stage 2 carries the details.

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

> **Correction (27 August 2026).** Until now this section described an
> encrypted, HMAC-manifest-signed backup and a `.dump.enc` filename. **None
> of that is implemented.** `backup-postgres.sh` writes a plain
> `--format=custom` dump plus a `.sha256` sidecar, and it **refuses to run**
> if `BACKUP_ENCRYPTION_KEY_FILE` or `BACKUP_HMAC_KEY_FILE` is set — the
> script's own error message names this document as the thing overstating it.
> `restore-postgres.sh` decrypts nothing, verifies no manifest, and refuses a
> `.enc` file rather than guessing. `deploy/backup/README.md` and
> `deploy/backup/offsite-copy.sh` do not exist either. What IS real is the
> sha256 sidecar, verified before any mutation, and the scratch-database
> default below.

```bash
DATABASE_URL=<production-url> \
BACKUP_DIR=/var/backups/awcms \
./deploy/backup/backup-postgres.sh
```

Then **prove the dump restores** — a dump that was never test-restored is
not verified evidence. `restore-postgres.sh` verifies the `.sha256` sidecar
before touching any target database:

```bash
DATABASE_URL=<production-url> \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump
```

(Defaults to restoring into the disposable `awcms_restore_test`
database — never the live one; `RESTORE_SCRATCH_DB` overrides that name.)
Record the dump filename, its `sha256` digest, and the restore-test
timestamp somewhere durable (deploy ticket/runbook log) — this is the
"evidence retention" this runbook asks for.

Off-site copy is a real obligation with no script behind it: copy the dump
and its sidecar to a second host yourself. The restore-test is what proves
the backup is usable; the off-site copy is about surviving loss of the
backup host, and nothing in this repo automates it.

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
