---
name: awcms-new-migration
description: Write a correct AWCMS PostgreSQL SQL migration. Use whenever adding/changing a table, column, index, constraint, or RLS. Enforces the NNN_awcms_<area>_<desc>.sql naming, tenant_id, RLS, FK indexes, timestamptz, and numeric per doc 04 & 10.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — New SQL Migration

Follow the standards in `docs/awcms/04_erd_data_dictionary.md` and `docs/awcms/10_template_kode_coding_standard.md`.

## Naming

```text
sql/NNN_awcms_<area>_<description>.sql
```

- `NNN` is sequential, zero-padded (e.g. `023`).
- **Do not** rename a migration that has already shipped; a correction = a new migration.
- Check the last number in `sql/` before adding one.

## Mandatory rules

1. `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (needs `pgcrypto`).
2. A tenant-scoped table **must** have a `tenant_id uuid NOT NULL` column.
3. Timestamps = `timestamptz`; money/quantity = `numeric` (not float).
4. `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`.
5. Indexes on `(tenant_id)`, on every child FK, and on `(tenant_id, created_at DESC)` for transactions/logs.
6. `CHECK` constraints for enum-like columns (status, type).
7. **RLS is mandatory** for tenant-scoped tables (see the template).
8. **Do not** wrap it in `BEGIN;`/`COMMIT;`/`ROLLBACK;`/`START
TRANSACTION;` — `scripts/db-migrate.ts` manages the migration transaction
   itself and `assertNoTransactionControl` will REJECT (error,
   not warning) any migration containing a transaction control
   statement at the top level (outside a comment/string
   literal/dollar-quoted body). Write the DDL directly, without a wrapper.
9. **Never** store a plaintext password/API key/secret.
10. A deletable master/config/draft table must have soft delete (`deleted_at`, `deleted_by`, `delete_reason`) + an active index/partial unique.
11. A NEW table without `tenant_id`/RLS (global, read/written across
    tenants — e.g. a configuration catalogue, a registry): document the reason
    in the migration header, then register the table name in `RLS_FREE_TABLES`
    in `scripts/security-readiness.ts` — otherwise `checkRlsEnabled`
    treats it as a tenant-scoped table without RLS and **blocks go-live**.
    (`ALLOWED_GLOBAL_TABLE_GRANTS` **does not exist** in this script — that
    still belongs to awcms-mini; do not look for it or register there.)
12. **DO NOT write per-table `GRANT ... TO awcms_app` blocks.** The `awcms_app`
    role has existed since `sql/019_awcms_db_role_separation.sql` (Issue #141), and 019
    installs `ALTER DEFAULT PRIVILEGES` so that new tables/sequences created by
    the migration owner are **automatically** granted to `awcms_app` — a manual
    GRANT is pure noise. What is NOT automatic: `FUNCTION` (see §SECURITY DEFINER)
    and objects created by ANOTHER role.

    **EXCEPT when your table must be NARROWER than that default.** Because 019
    grants all four verbs blanket, writing only `GRANT SELECT, INSERT, UPDATE`
    does **not** hold back DELETE — it has already been granted. The control "rows in
    this table must not be deleted" is only real if the migration writes an
    EXPLICIT `REVOKE DELETE ON <table> FROM awcms_app;`. This is not hypothetical:
    `sql/125` at one point carried a comment asserting that control while not
    enforcing it at all (ADR-0094). A narrowed table MUST be
    registered in `RETIRED_TENANT_TABLE_PRIVILEGES`
    (`scripts/security-readiness.ts`) with the list of remaining verbs, or
    `checkRuntimeRoleGrants` goes red. Verify with a real query
    (`information_schema.role_table_grants`), not by reading the migration.

13. **`awcms_worker`/`awcms_setup` DO EXIST — and their grants MUST be explicit.**
    CORRECTION 2026-07-25: an earlier version of this skill stated that those two roles
    did not exist; that is **WRONG** as of `sql/022_awcms_db_worker_setup_roles.sql`.
    They deliberately do **not** take part in `ALTER DEFAULT PRIVILEGES` — that is the
    core of their least-privilege. So if your new table is read/written by a scheduled job:
    - write `GRANT <verb...> ON <table> TO awcms_worker;` as minimally as possible
      (only the verbs the job actually uses — e.g. a retention job that
      anonymises needs just `SELECT, UPDATE`, without `DELETE`/`INSERT`);
    - add an **identical** entry to `WORKER_ROLE_GRANTS` in
      `scripts/security-readiness.ts`, plus a comment giving the reason for each verb.

    That matrix is guarded by a two-way drift test: under-grant → the job hits
    `permission denied` in production; over-grant → the isolation that was the reason
    for the role split is a lie. Forgetting to update it turns `bun run check` red
    (a hard failure, not a silent one).

14. **A NEW table must answer the data-subject question** (ADR-0094) — what
    does this table store about SOMEONE, and what happens to it
    when that person asks to be erased. The answer is written as a
    `subjectData` entry in the `module.ts` of the module that **owns the table**, not in the
    migration. This applies to EVERY `awcms_*` table, not just the ones that
    obviously contain personal data: even a table that only carries `created_by`
    must state it (`erasure: "severed_with_subject_row"`), and a
    table that genuinely stores nothing about anyone is declared
    in `NO_SUBJECT_DATA` (`scripts/subject-data-coverage-check.ts`)
    with a reason. `bun run subject-data:coverage:check` refuses silence;
    `bun run subject-data:registry:check` verifies the answer is correct
    against `sql/` — including whether the `erasure` mode you chose
    is actually within `awcms_app`'s privileges after rules 12 and 13
    above. Procedure + the five modes: skill `awcms-data-lifecycle`
    §Data subject rights.

## Template

```sql
CREATE TABLE IF NOT EXISTS awcms_<name> (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid
);

CREATE INDEX IF NOT EXISTS awcms_<name>_tenant_idx
  ON awcms_<name> (tenant_id);
CREATE INDEX IF NOT EXISTS awcms_<name>_tenant_created_idx
  ON awcms_<name> (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS awcms_<name>_active_idx
  ON awcms_<name> (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;
-- Index naming convention: SUFFIX `_idx` (unique: `_uidx` or `_key`), not
-- the prefix `idx_` — e.g. sql/013, sql/015:
-- `awcms_workflow_task_assignments_task_idx`,
-- `awcms_reporting_export_runs_scheduled_idx`.

ALTER TABLE awcms_<name> ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_<name> FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_<name>_tenant_isolation ON awcms_<name>
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### `ENABLE` without `FORCE` = RLS dead, not RLS weak

**`FORCE` is not an optional tightening — without it your policy is never evaluated.**
PostgreSQL skips RLS for the **table owner**, and this application connects
as the migration owner via `DATABASE_URL`. So `ENABLE` on its own
produces a table that _looks_ protected — the policy exists, `relrowsecurity`
is true — while every query returns rows from all tenants.

This is not hypothetical: migrations 002-008 and 010-012 shipped **23 tables**
like that (including `awcms_identities`, `awcms_sessions`), and an earlier audit
actually recorded "RLS ENABLE on all tenant-scoped tables" as
evidence of health. Fixed by `sql/017_awcms_enforce_rls_force.sql`.

When reviewing/auditing RLS: **grep for `FORCE`, not `ENABLE`**, and check the
application's connection role. A `SUPERUSER`/`BYPASSRLS` connection bypasses RLS _even with_
`FORCE` — that is a separate layer (the least-privilege `awcms_app` role).

How to prove a policy actually enforces (rather than merely being registered): create a
throwaway DB + a `NOSUPERUSER NOBYPASSRLS` role, run the migrations **as
that role** so it becomes the owner, seed two tenants, then read tenant B's data
with `app.current_tenant_id` set to tenant A. It must be zero rows.

**FKs are not protected by RLS.** Referential integrity checks run
with owner rights and bypass RLS, so an FK that is not tenant-scoped still
accepts cross-tenant values even with `FORCE` active. For a self-reference column
or an FK between tenant-scoped tables, use a **composite** FK:

```sql
-- needs UNIQUE (tenant_id, id) on the target table
FOREIGN KEY (tenant_id, parent_id) REFERENCES awcms_<target> (tenant_id, id)
```

## Using `SECURITY DEFINER` (bootstrap reads before a tenant context exists)

Sometimes a query has to run **before** any tenant context exists at all
(e.g. public resolution of `hostname`/`tenantCode` -> `tenant_id`), while
the table is `FORCE ROW LEVEL SECURITY`. Do not drop `FORCE ROW LEVEL
SECURITY` to work around it — write a narrow `SECURITY DEFINER` function.
Mandatory checklist (full detail + the reason for each item:
`docs/adr/0003-postgresql-rls-multi-tenant.md` §Checklist). This base does not yet
have its own `SECURITY DEFINER` example — the canonical reference is in the
awcms-mini repo (migration 033, the tenant domain lookup function; Issue #559 in that
repo), not in this repo's `sql/`:

1. Confirm the migration owner role really is a superuser (`SELECT
rolsuper FROM pg_roles`) — the security of this mechanism comes from there, not
   from RLS/`FORCE`.
2. The function body is static/fixed SQL, parameters are always parameterised
   function arguments — no dynamic SQL/string concatenation.
3. Minimise the returned columns — no sensitive column unless
   genuinely required.
4. `REVOKE ALL ... FROM PUBLIC` then an explicit `GRANT EXECUTE` to a
   specific role (e.g. `awcms_app`) — this is **not** automatically covered by
   the `ALTER DEFAULT PRIVILEGES` in `sql/019_awcms_db_role_separation.sql`
   (that covers only `TABLES`/`SEQUENCES`, not `FUNCTIONS`). It is number 013 in
   awcms-mini; in this repo awcms_app's default privileges are installed by `sql/019`.
5. `SET search_path = public, pg_temp` in the function definition.
6. `STABLE`/`IMMUTABLE` for a read-only function, not the default `VOLATILE`.
7. Empirical verification against a running DB (not an assumption from
   the PostgreSQL documentation alone) before reporting this mechanism as safe.
8. If there is a second conditional query after this function (e.g. "if
   a row is found, query another table"), consider whether the differing
   round-trip count between outcomes becomes a timing side channel — merge them
   into one query via `JOIN` if the second table is already RLS-free/publicly
   readable.

## Append-only & immutable

- Posted sales documents & stock movements: **append-only**, never updated/deleted. Corrections go through a reversal/return/adjustment.
- Do not add soft delete to a posted/append-only/audit/security log/exported tax batch entity.
- For a business key that may be reused after archiving, use a partial unique index `WHERE deleted_at IS NULL`.

## Verification

```bash
bun run db:migrate   # no double-run, stops on error
```

After migrating: check critical row counts, constraints/indexes, the soft-delete partial unique, and that RLS is active. Update the ERD/data dictionary if needed (doc 04) and the migration matrix (doc 13).
