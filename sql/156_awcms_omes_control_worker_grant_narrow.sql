-- ADR-0122 / Issue ahliweb/omes#196 — narrow `awcms_worker`'s grant on the
-- eight `omes_control` tables `sql/154` created.
--
-- ## What `sql/154` over-granted
--
-- `sql/154` gave `awcms_worker` the SAME `SELECT, INSERT, UPDATE, DELETE`
-- combined-role `GRANT` it gave `awcms_app`:
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_omes_servers
--     TO awcms_app, awcms_worker;
--
-- for all eight tables (servers, enrollments, deployments,
-- operation_requests, jobs, health_snapshots, backup_snapshots,
-- audit_projections). At the time `sql/154` landed, `omes_control` had no
-- `jobs` descriptor at all — it registers no scheduled worker entrypoint
-- (PR #814 shipped schema/RLS/permissions/descriptor only; the control API
-- that writes these tables lands separately, on `awcms_app`, per-request).
-- The only thing `awcms_worker` actually touches here is the generic
-- `data-lifecycle:archive-purge` engine, driven by each table's
-- `dataLifecycle` descriptor (`src/modules/omes-control/module.ts`): every
-- one of the eight is `mode: "hard_delete"`, `executionMode: "generic"` — a
-- bounded cursor SELECT plus an aged-row DELETE, the same shape as
-- `awcms_seo_not_found_observations` (`sql/060`) or `awcms_form_drafts`'
-- physical-purge phase (`sql/062`). `INSERT`/`UPDATE` were never used by any
-- worker-run statement; holding them was a live isolation breach caught by
-- `security:readiness worker/setup grant check` (Issue #163) — the exact
-- least-privilege matrix in `scripts/security-readiness.ts` never claimed
-- these tables, so the check correctly reported `awcms_worker` as
-- OVER-granted the moment `sql/154` landed.
--
-- ## Why this is a REVOKE, not an edit to `sql/154`
--
-- `sql/154` is an applied migration; editing it in place would block
-- `bun run db:migrate` on every deployment that has already run it. The fix
-- is additive: revoke exactly the two excess verbs, per role, from a NEW
-- migration.
--
-- `awcms_app` is untouched — the control API needs full CRUD there.
--
-- ## Why the `REVOKE`s are single-role, not the combined-role form
--
-- `sql/154`'s combined-role `GRANT ... TO awcms_app, awcms_worker` is not
-- read by `tests/db-role-separation-worker-setup-migration.test.ts`'s replay
-- parser, which only recognizes one-role-per-statement
-- `GRANT|REVOKE ... ON <table> TO|FROM (awcms_worker|awcms_setup);` lines (by
-- design — `awcms_app` is out of its scope). Revoking with that same
-- single-role form keeps the statements parseable, and the paired
-- single-role `GRANT SELECT, DELETE ... TO awcms_worker` below is a no-op
-- against the real database (both privileges are already held via `sql/154`)
-- that exists only so the static replay's picture of `awcms_worker`'s final
-- grant on these eight tables matches what `checkWorkerSetupRoleGrants`
-- observes on a real Postgres, and matches the least-privilege matrix this
-- migration adds `WORKER_ROLE_GRANTS` entries for.

GRANT SELECT, DELETE ON awcms_omes_servers TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_servers FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_enrollments TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_enrollments FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_deployments TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_deployments FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_operation_requests TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_operation_requests FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_jobs TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_jobs FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_health_snapshots TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_health_snapshots FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_backup_snapshots TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_backup_snapshots FROM awcms_worker;

GRANT SELECT, DELETE ON awcms_omes_audit_projections TO awcms_worker;
REVOKE INSERT, UPDATE ON awcms_omes_audit_projections FROM awcms_worker;
