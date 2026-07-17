-- Issue #141 — least-privilege `awcms_app` runtime role (ported from
-- awcms-mini `013_awcms_mini_enforce_rls_least_privilege.sql`, part 2 of 2).
-- Part 1 (`FORCE ROW LEVEL SECURITY` on the 23 tables that only `ENABLE`d it)
-- shipped as `017_awcms_enforce_rls_force.sql`.
--
-- Correction carried here rather than fixed in place (Issue #155): the header
-- of `014_awcms_email_schema.sql` calls inline `ENABLE`+`FORCE` "the convention
-- every table added since migration 002 follows". That was never true —
-- migrations 002-008 and 010-012 only `ENABLE`d, which is exactly what 017 had
-- to repair. The claim cannot be edited out of 014: `scripts/db-migrate.ts`
-- checksums applied migrations and refuses any edit to one, so changing even a
-- comment there hard-fails `db:migrate` on every already-migrated deployment
-- while staying green on an empty CI database. Read 014's header with this
-- note; do not "fix" it.
--
-- FINDING: 017 closed the table-OWNER bypass, but PostgreSQL bypasses RLS
-- UNCONDITIONALLY for SUPERUSER and BYPASSRLS roles — `FORCE` does not apply
-- to them. Today `DATABASE_URL` is the migration owner (`scripts/db-migrate.ts`
-- reads the same var), which on a typical deployment IS a superuser: every
-- `awcms_*_tenant_isolation` policy in this repo is therefore still inert at
-- runtime, and tenant isolation rests entirely on the application's
-- `WHERE tenant_id` clauses. RLS only becomes a real second layer once the
-- application connects as a role that is neither superuser, nor BYPASSRLS, nor
-- the tables' owner. This migration creates that role.
--
-- Deliberately NOT a full port of mini's later `045_awcms_mini_db_role_
-- separation.sql` (which splits the runtime into `app`/`worker`/`setup` and
-- narrows each one's grants on the RLS-free global tables). That split needs a
-- per-script, per-table audit of every write path, and mini only did it after
-- its blanket role had been in production for 30+ migrations. This migration
-- ports the blanket-DML role exactly as mini's 013 defined it. Consequence,
-- stated plainly rather than implied: on the RLS-free global tables
-- (`awcms_tenants`, `awcms_permissions`, `awcms_setup_state`,
-- `awcms_schema_migrations`, `awcms_modules` + registry dependents),
-- `awcms_app` has DML it does not need. That is unchanged from today's
-- superuser-for-everything posture, i.e. this migration is a strict
-- improvement, not a regression — but it is not the end state.
--
-- NO ROLE for `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL`: those env vars are
-- real code seams (`getWorkerDatabaseClient`/`getSetupDatabaseClient` in
-- `src/lib/database/client.ts`, separate pools + per-kind pool sizing) but
-- they fall back to `DATABASE_URL` when unset, and this repo ships no
-- `awcms_worker`/`awcms_setup` role for them to point at. `.env.example` and
-- doc 18 now say so instead of advertising roles that do not exist — an
-- operator who followed the old wording would have hit `permission denied` on
-- every background job.
--
-- NO DML in this migration, deliberately: a migration that writes rows to a
-- `FORCE ROW LEVEL SECURITY` table passes on an empty CI database and fails on
-- a populated production one (`current_setting('app.current_tenant_id')` throws
-- when the GUC is unset, and the migration runner sets no GUC). See `sql/018`
-- for the `NO FORCE` -> DML -> `FORCE` pattern if a later migration needs one.

BEGIN;

-- 1. The role. Created NOLOGIN and passwordless — a password is a secret and
-- never belongs in a committed migration. Deployment activates it explicitly:
--   ALTER ROLE awcms_app LOGIN PASSWORD '<secret>';
-- and then points `DATABASE_URL` at it, keeping the owner/superuser connection
-- string for `bun run db:migrate` only (doc 18 §Model role database).
-- Idempotent: a deployment init script may have created it (with LOGIN)
-- already, in which case this is a no-op and the LOGIN attribute is preserved.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_app') THEN
    CREATE ROLE awcms_app NOLOGIN;
  END IF;
END
$$;

-- 2. Fail-closed default tenant context. Every tenant-isolation policy in this
-- repo is `USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`,
-- and `current_setting/1` THROWS on an unset GUC rather than returning NULL.
-- Without this default, any query reaching an RLS table outside `withTenant()`
-- would 500 with `unrecognized configuration parameter`; with it, it matches
-- the all-zero UUID — no real tenant — and returns zero rows. So the failure
-- mode of a missing `SET LOCAL` is "no data", never "someone else's data" and
-- never a crash. `withTenant()`'s `SET LOCAL app.current_tenant_id` overrides
-- this per transaction; this is the backstop, not the mechanism.
--
-- Applies at connection time for a role that LOGINs as `awcms_app`. It does
-- NOT apply to `SET ROLE awcms_app` from another session — a real login is
-- required for this backstop (and to verify it).
ALTER ROLE awcms_app SET app.current_tenant_id = '00000000-0000-0000-0000-000000000000';

-- 3. DML grants only — no DDL, no ownership, no BYPASSRLS, not superuser.
-- Coarse at the table level by design: on tenant-scoped tables the row-level
-- policy is the real boundary (ADR-0003), which is exactly what makes the
-- blanket grant safe THERE (see the header for where it is not).
GRANT USAGE ON SCHEMA public TO awcms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO awcms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO awcms_app;

-- 4. Future tables/sequences created by this same migration owner auto-grant to
-- the role, so later migrations need no per-table GRANT boilerplate — and,
-- more importantly, so a new tenant-scoped table cannot silently ship
-- unreachable-at-runtime because someone forgot one.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awcms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO awcms_app;

COMMIT;
