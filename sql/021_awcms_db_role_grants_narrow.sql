-- Issue #160 (area:security, area:database) — narrow `awcms_app`'s blanket DML
-- on the GLOBAL, RLS-free tables. Follow-up to `sql/019_awcms_db_role_
-- separation.sql`, which deliberately ported awcms-mini's blanket-DML role
-- (its migration 013) exactly, leaving the per-table narrowing (mini's later
-- migration 045) for a separate, deployment-affecting migration. This is it —
-- for the `awcms_app` half only (see SCOPE below).
--
-- WHY THIS EXISTS (residual confirmed by the PR #159 security audit, verified
-- empirically as `awcms_app` on Postgres 18): `sql/019` grants
-- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`. That
-- is correct and safe on the tenant-scoped tables — RLS `FORCE` (sql/017) is
-- the real row-level boundary there, and the table-level grant is coarse by
-- design (ADR-0003). But it ALSO covers the nine GLOBAL tables that have NO
-- row-level security at all, so RLS cannot claw any of it back. On those,
-- `awcms_app` held DML it never uses at runtime:
--   * `UPDATE awcms_permissions`      — the permission catalog (read-only at
--                                        runtime; seeded only by migrations).
--   * `DELETE awcms_schema_migrations` — the migration ledger (written only by
--                                        `bun run db:migrate`, as the owner).
--   * `DELETE awcms_tenants`           — deleting another tenant's root row.
-- A compromised runtime connection could corrupt the migration ledger or the
-- permission catalog. This migration removes exactly that excess and nothing
-- that a real code path uses.
--
-- SCOPE — `awcms_app` ONLY; the worker/setup role split is deferred (Issue
-- #160 also proposes porting mini 045's `awcms_worker`/`awcms_setup` split).
-- That split needs a per-write-path audit of all seven `getWorkerDatabaseClient`
-- scripts and the setup bootstrap, PLUS a `src/lib/database/client.ts` fallback
-- change to make `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` map to real roles —
-- a change that breaks every deployment that has not opted into those URLs
-- (mini's own attempt surfaced 423 fixture failures through the setup fallback
-- path). mini itself only did the split after 30+ migrations of the blanket
-- role in production. Narrowing `awcms_app` here fully closes the confirmed
-- residual on its own; the split is defense-in-depth beyond it and is left as a
-- follow-up rather than half-done. Doc 18 §Model role database records this.
--
-- WHAT IS DELIBERATELY KEPT (verified by grepping every write path, not
-- assumed — same discipline mini's 045 header documents):
--   * `awcms_tenants`     — DELETE revoked, but SELECT/INSERT/UPDATE KEPT.
--       INSERT: `platform-bootstrap.ts` creates the tenant row through the
--       setup path, which FALLS BACK to the `awcms_app` connection when
--       `SETUP_DATABASE_URL` is unset (`getSetupDatabaseClient`). UPDATE:
--       `tenant-settings-directory.ts` edits tenant name/legal name/locale/
--       theme at request time AS `awcms_app` (the web runtime). Revoking
--       either would break the setup wizard and the tenant-settings screen.
--   * `awcms_setup_state` — DELETE revoked, but SELECT/INSERT/UPDATE KEPT.
--       `platform-bootstrap.ts` INSERTs the singleton lock and UPDATEs it with
--       the new tenant id, again through the `awcms_app` setup-fallback path.
--       Nothing ever deletes the setup-state singleton.
--   * The five module-registry tables (`awcms_modules`,
--     `awcms_module_dependencies`, `awcms_module_navigation`,
--     `awcms_module_jobs`, `awcms_module_health_checks`) — full DML KEPT.
--     `descriptor-sync.ts` (INSERT/UPDATE/DELETE) and `health-registry.ts`
--     (INSERT) genuinely write these at runtime through the module-management
--     module. Not part of the confirmed residual; left untouched.
--
-- Read-only narrowing (INSERT/UPDATE/DELETE revoked, SELECT kept):
--   * `awcms_permissions`       — never written by any runtime code path
--     (permission-sync.ts only SELECTs; the module README states it "never
--     writes to the catalog"). Migrations seed it.
--   * `awcms_schema_migrations` — written only by the migration runner
--     (`scripts/db-migrate.ts`), which connects as the owner, never `awcms_app`.
--
-- The `ALTER DEFAULT PRIVILEGES` from `sql/019` is INTENTIONALLY LEFT AS-IS: it
-- keeps auto-granting full DML on FUTURE tenant-scoped tables (so a new
-- tenant table cannot ship unreachable-at-runtime). The nine global tables all
-- already exist, so a per-table REVOKE on them is permanent — default
-- privileges only affect tables created LATER. The regression guard for a
-- FUTURE global table silently inheriting blanket DML again is the new
-- `checkRuntimeRoleGrants` grant check in `scripts/security-readiness.ts`
-- (Issue #160), which is where "trust every future migration to narrow itself"
-- is replaced by a real assertion.
--
-- NO DML in this migration (only REVOKE — pure DDL, idempotent, re-appliable):
-- it therefore does NOT touch a `FORCE ROW LEVEL SECURITY` table's rows, so the
-- `NO FORCE` -> DML -> `FORCE` pattern (`sql/018`/`020`) is not needed here.
-- `REVOKE` on a privilege the role does not hold is a silent no-op, so re-runs
-- are safe. Depends on `sql/019` having created `awcms_app` (migrations run in
-- order; 019 always creates it before 021 runs).

BEGIN;

-- 1. Read-only global catalogs — no runtime write path, dedicated role or
-- fallback. Revoke every write, keep SELECT.
REVOKE INSERT, UPDATE, DELETE ON awcms_permissions FROM awcms_app;
REVOKE INSERT, UPDATE, DELETE ON awcms_schema_migrations FROM awcms_app;

-- 2. Tenant root + setup singleton — only DELETE is excess. INSERT/UPDATE/SELECT
-- stay: both are written at runtime by `awcms_app` (setup fallback path and, for
-- awcms_tenants, the tenant-settings screen). See header for the exact callers.
REVOKE DELETE ON awcms_tenants FROM awcms_app;
REVOKE DELETE ON awcms_setup_state FROM awcms_app;

-- The five module-registry tables keep their full DML grant from `sql/019`
-- (genuine request-time writes via descriptor-sync/health-registry) — no REVOKE.

COMMIT;
