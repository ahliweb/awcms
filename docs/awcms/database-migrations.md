🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](database-migrations.id.md)

# Database Migration Runner

> **Document status (AWCMS).** This migration runner mechanism is inherited
> directly from the `awcms-mini` technical base (Issue 0.2 in the origin repo) and
> has not been re-adapted/re-verified in the AWCMS repo — no ERP domain
> migration has been written yet. The conventions below are the standard that applies
> the moment the first ERP module migration is added.

This document records the AWCMS PostgreSQL migration runner.

## Step 0 — take AND verify a backup

Applies to every shared environment — production, and any second
environment someone stands up beside it. This is not
advice, it is the first step: migrations in this repo are **forward-only**
(there is no `down`), so the only real rollback path is a
restore. A backup that has never been restore-tested is not a rollback path —
it is just a file.

```bash
# 1. take the backup (custom format + sha256 sidecar, verified right there and then)
DATABASE_URL=<owner/privileged url> \
BACKUP_DIR=/var/backups/awcms \
./deploy/backup/backup-postgres.sh

# 2. prove the dump can genuinely be restored — a verify-only drill:
#    restore into a single-use database, inspect it, then DROP it.
#    Without --target this script NEVER touches the live database.
DATABASE_URL=<owner/privileged url> \
./deploy/backup/restore-postgres.sh /var/backups/awcms/awcms_<db>_<timestamp>.dump
```

Step 2 is not optional. `backup-postgres.sh` only proves the file is
readable; `restore-postgres.sh` is what proves its contents become a
database again — including that tables with `FORCE ROW LEVEL SECURITY` survive
the round-trip. Tenant isolation lost during a restore is a
silent failure: everything looks healthy, and not a single tenant is
separated.

The PostgreSQL database here is a Coolify-managed container with no
published port, so both scripts are run as one-shot containers
sharing the DB container's network namespace — exactly the same pattern
as running the migrations themselves (see
[`environments.md`](environments.md) §Running migrations, and the
comment header in each script for the full `docker run` command).

Record the dump filename, its `sha256`, and the time of the drill in the deploy notes —
that is the evidence
[`production-preflight-runbook.md`](production-preflight-runbook.md)
Stage 2 asks for before `--backup-verified` may be used.

> The at-rest encryption and the HMAC-signed manifest the runbook mentions
> do **not exist yet**; both scripts refuse to run (rather than silently
> ignoring it) when the key variable is set, so nobody assumes a
> plain dump is encrypted.

## Command

```bash
DATABASE_URL=postgres://awcms:awcms_password@localhost:5432/awcms bun run db:migrate
```

`DATABASE_URL` must come from the environment. Do not commit `.env`, database dumps, or production credentials.

## Runner contract

- The runtime is Bun, via `bun scripts/db-migrate.ts`.
- The driver is `Bun.SQL`, not `pg` or a Node.js adapter.
- Migration files are read from `sql/` and ordered by file name.
- File names must follow `NNN_awcms_<area>_<description>.sql`.
- The runner ensures the `awcms_schema_migrations` table exists.
- Migrations already recorded are skipped.
- A SHA-256 checksum is stored for every applied migration.
- If an already-applied migration changes, the runner stops and demands a new migration.
- Every new migration runs inside the runner's transaction; an outer `BEGIN; ... COMMIT;` wrapper may exist in older files and is stripped before execution.
- The runner sets `lock_timeout = 5s` and `statement_timeout = 15min` on its own session, right after the advisory lock is taken — this is not the operator's responsibility on the command line. `lock_timeout` prevents a single DDL statement waiting on `ACCESS EXCLUSIVE` from queueing every request behind it (the most common way a "quick" `ALTER TABLE` takes the site down); `statement_timeout` puts an upper bound on a backfill that overruns. A migration that genuinely needs longer states so itself with `SET LOCAL statement_timeout` inside its own file, so the intent is readable where the reviewer looks.
- Errors stop the process with a non-zero exit code.
- Error messages never print the `DATABASE_URL` value.

## Flow

```mermaid
flowchart TD
  A[Read sql/*.sql] --> B[Validate file names]
  B --> C[Compute checksum]
  C --> D[Take advisory lock]
  D --> E{Already recorded?}
  E -- Yes --> F{Checksum matches?}
  F -- Yes --> G[Skip]
  F -- No --> H[Stop non-zero]
  E -- No --> I[Run inside a transaction]
  I --> J[Record name + checksum]
  J --> K[Continue]
  G --> K
```

## Rules for writing a new migration

1. Add a new file in `sql/` with the next number.
2. Do not edit a migration that has ever been applied in a shared environment or production.
3. Do not put secrets, customer/financial/payroll data dumps, or real environment values in SQL.
4. Tenant-scoped schema (including ERP entities: ledger, inventory, procurement, manufacturing, HR/payroll) must follow the PostgreSQL + RLS standard in the relevant governance/ADR documents (see ADR-0001 and the other foundation ADRs still to come for RLS/RBAC-ABAC).
5. Deletable resources must use soft delete columns per the soft-delete/immutability ADR standard inherited from the base.
</content>
