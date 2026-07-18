-- Issue #163 (area:security, area:database) — split the runtime into
-- purpose-specific least-privilege roles: add `awcms_worker` (unattended
-- background jobs) and `awcms_setup` (one-time bootstrap) alongside the
-- already-narrowed `awcms_app` (sql/019 + sql/021). Ports the SECOND half of
-- awcms-mini's role separation (its migration 045); the FIRST half —
-- narrowing `awcms_app` itself — already shipped as sql/021 (Issue #160).
--
-- WHY THIS IS A SEPARATE, LATER MIGRATION (deliberately deferred from #160,
-- recorded in sql/021's header, doc 18 §Model role database, and #163):
--   1. It needs a per-write-path audit of all SEVEN `getWorkerDatabaseClient`
--      scripts and the setup bootstrap to size each grant to exactly what its
--      code touches — done for THIS repo, NOT copied from mini (mini's worker
--      set is visitor-analytics/blog/form-drafts, none of which exist here;
--      awcms's is audit/sync/email/domain-events/workflow/reporting). Copying
--      mini's grant list verbatim would be both wrong AND unsafe.
--   2. It is opt-in, NOT breaking: `src/lib/database/client.ts`'s
--      `getWorkerDatabaseClient`/`getSetupDatabaseClient` still FALL BACK to
--      `DATABASE_URL` (the `awcms_app` connection) when
--      `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` are unset. A deployment that
--      does not configure those URLs keeps working exactly as before — these
--      roles simply exist, unused, until an operator points a URL at one and
--      activates LOGIN (same two-step as `awcms_app` in sql/019). mini's own
--      attempt at a HARD cutover surfaced 423 fixture failures through the
--      setup-fallback path; this repo does not repeat that.
--
-- The isolation benefit is therefore UNEVEN by design, and honestly so:
--   * `awcms_permissions`/`awcms_schema_migrations` are never written by any
--     runtime path (dedicated role or fallback), so `awcms_app` was already
--     read-only/none on them (sql/021).
--   * `awcms_tenants`/`awcms_setup_state` are only FULLY isolated from
--     `awcms_app` once `SETUP_DATABASE_URL` points at `awcms_setup`; until
--     then the setup wizard still runs those INSERT/UPDATEs AS `awcms_app`
--     through the fallback (which is exactly why sql/021 kept INSERT/UPDATE
--     for `awcms_app` on them). An explicit, documented trade-off of the
--     optional-role design — not an oversight.
--
-- GRANT DERIVATION — every table/verb below was traced from the actual SQL
-- reachable from each worker script and the bootstrap, at repo revision
-- c7fd87f9, and cross-checked empirically against Postgres 18 with
-- `has_table_privilege`. The two landmines mini's 045 header documents were
-- paid again here and are reflected below (see project memory
-- `awcms-db-role-separation-notes`):
--   * `RETURNING <col>` requires SELECT in addition to the write verb —
--     Postgres needs SELECT on a column for it to appear in a RETURNING list.
--     Every `INSERT ... RETURNING id` in the setup bootstrap and every claim
--     UPDATE ... RETURNING in the workers therefore grants SELECT too.
--   * `ON CONFLICT ... DO UPDATE` requires UPDATE; `ON CONFLICT ... DO NOTHING`
--     does NOT. The dispatchers use both; only the DO UPDATE upserts add UPDATE.
--
-- No sequence grants: the only `serial`/`nextval` default in the schema is
-- `awcms_schema_migrations.id` (sql/001), which no runtime role INSERTs into;
-- every other id is `uuid DEFAULT gen_random_uuid()` or `GENERATED ALWAYS AS
-- IDENTITY` (identity columns need no sequence USAGE — INSERT on the table
-- suffices). Verified against Postgres 18.
--
-- Neither role is SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, or the tables'
-- owner, so FORCE ROW LEVEL SECURITY (sql/017) applies to them exactly as it
-- does to `awcms_app`; they set the tenant GUC through `withTenant`
-- (`SET LOCAL app.current_tenant_id`) on every tenant-scoped statement.
--
-- NO DML in this migration (only CREATE ROLE / ALTER ROLE / GRANT — pure DDL,
-- idempotent, re-appliable): it never touches a FORCE-RLS table's rows, so the
-- `NO FORCE` -> DML -> `FORCE` pattern (sql/018/020) is not needed. Depends on
-- the target tables existing (migrations 001-016) and runs after sql/021.

BEGIN;

-- 1. The two roles. Created NOLOGIN and passwordless — a password is a secret
-- and never belongs in a committed migration. A deployment that opts into role
-- separation activates each explicitly, exactly as for `awcms_app`:
--   ALTER ROLE awcms_worker LOGIN PASSWORD '<secret>';
--   ALTER ROLE awcms_setup  LOGIN PASSWORD '<secret>';
-- and points `WORKER_DATABASE_URL`/`SETUP_DATABASE_URL` at them (doc 18
-- §Model role database). Idempotent: a deployment init script may have created
-- them (with LOGIN) already, in which case this is a no-op and LOGIN is kept.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_worker') THEN
    CREATE ROLE awcms_worker NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_setup') THEN
    CREATE ROLE awcms_setup NOLOGIN;
  END IF;
END
$$;

-- 2. The same fail-closed default tenant GUC `awcms_app` gets (sql/019 §2): a
-- query reaching an RLS-forced table outside `withTenant()` matches the
-- all-zero UUID — no real tenant — and returns zero rows, instead of throwing
-- `unrecognized configuration parameter` on the unset GUC. Applies at LOGIN
-- for a role that connects as this role; it does not apply to `SET ROLE`.
-- (Setting a customized/placeholder GUC on a role requires SUPERUSER — the
-- migration runner has it; see sql/019's header and the integration harness.)
ALTER ROLE awcms_worker SET app.current_tenant_id = '00000000-0000-0000-0000-000000000000';
ALTER ROLE awcms_setup  SET app.current_tenant_id = '00000000-0000-0000-0000-000000000000';

GRANT USAGE ON SCHEMA public TO awcms_worker;
GRANT USAGE ON SCHEMA public TO awcms_setup;

-- ===========================================================================
-- 3. awcms_worker — EXACTLY the tables each of the seven unattended scripts
-- touches (traced per-script from the application code each calls). No grant
-- at all on any global catalog it does not read: `awcms_permissions`,
-- `awcms_schema_migrations`, `awcms_setup_state`, `awcms_modules` (+ registry),
-- and it holds only SELECT on `awcms_tenants` (never writes the tenant root).
-- ===========================================================================

-- Every batched worker iterates `SELECT id FROM awcms_tenants WHERE status =
-- 'active'` (src/lib/jobs/batching.ts + inline in object-sync/email). Root
-- table, no RLS — read-only is all any worker needs.
GRANT SELECT ON awcms_tenants TO awcms_worker;

-- logs:audit:purge (scripts/audit-log-purge.ts -> logging/audit-purge.ts):
-- DELETE ... WHERE id IN (SELECT ...) RETURNING id (needs SELECT for both the
-- subquery and RETURNING); count(*) on --dry-run (SELECT); and the purge
-- self-audit INSERT (recordAuditEvent). Also written by the domain-events
-- dead-letter path + sample-audit consumer.
GRANT SELECT, INSERT, DELETE ON awcms_audit_events TO awcms_worker;

-- sync:objects:dispatch (scripts/object-sync-dispatch.ts -> sync-storage/
-- object-dispatch.ts): claim UPDATE ... (SELECT ... FOR UPDATE SKIP LOCKED)
-- ... RETURNING (UPDATE + SELECT), then status-guarded finalize UPDATEs.
GRANT SELECT, UPDATE ON awcms_object_sync_queue TO awcms_worker;

-- email:dispatch (scripts/email-dispatch.ts -> email/email-dispatch.ts):
-- three-phase claim/send/finalize on the queue (UPDATE + SELECT via the claim
-- RETURNING), a delivery-attempt INSERT (ON CONFLICT DO NOTHING — no UPDATE),
-- and read-only lookups of templates/suppression/default-locale.
GRANT SELECT, UPDATE ON awcms_email_messages TO awcms_worker;
GRANT INSERT ON awcms_email_delivery_attempts TO awcms_worker;
GRANT SELECT ON awcms_email_templates TO awcms_worker;
GRANT SELECT ON awcms_email_suppression_list TO awcms_worker;

-- workflow:escalations:dispatch (scripts/workflow-escalations-dispatch.ts ->
-- workflow-approval/workflow-escalation.ts): read due tasks (join
-- instances/definitions), optimistic-concurrency escalate UPDATE ... RETURNING
-- (UPDATE + SELECT), assignment INSERT (ON CONFLICT DO NOTHING). The
-- idempotency guard is the conditional UPDATE itself — no separate guard table.
GRANT SELECT, UPDATE ON awcms_workflow_tasks TO awcms_worker;
GRANT SELECT ON awcms_workflow_instances TO awcms_worker;
GRANT SELECT ON awcms_workflow_definitions TO awcms_worker;
GRANT INSERT ON awcms_workflow_task_assignments TO awcms_worker;

-- domain-events:dispatch (scripts/domain-events-dispatch.ts -> domain-event-
-- runtime/dispatch-domain-events.ts) claims/executes/finalizes deliveries and
-- runs the registered projector consumers. Note appendDomainEvent (reached
-- from workflow escalation) INSERTs `awcms_domain_events` ... RETURNING id,
-- event_sequence (INSERT + SELECT) and INSERTs a delivery per consumer
-- (ON CONFLICT DO NOTHING). The dispatcher itself SELECT/UPDATEs deliveries.
GRANT SELECT, INSERT ON awcms_domain_events TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_domain_event_deliveries TO awcms_worker;
GRANT SELECT ON awcms_domain_event_consumer_state TO awcms_worker;
-- consumer-effect once-only guard: INSERT ... ON CONFLICT DO NOTHING RETURNING
-- id (INSERT + SELECT).
GRANT SELECT, INSERT ON awcms_domain_event_consumer_effects TO awcms_worker;
-- activity-rollup projector: INSERT ... ON CONFLICT DO UPDATE (INSERT + UPDATE).
GRANT INSERT, UPDATE ON awcms_domain_event_activity_daily TO awcms_worker;

-- reporting:projections:refresh + reporting:exports:dispatch (reporting/
-- projection-incremental-worker.ts, projection-rebuild.ts, scheduled-export-
-- dispatch.ts). Projection stores upsert cursors/metrics/state (ON CONFLICT DO
-- UPDATE), advance/finalize running rebuild runs (UPDATE only — createRebuildRun
-- is API-only), and record export runs (INSERT ... RETURNING). The incremental
-- and rebuild engines SELECT tenant-scoped SOURCE tables to build projections.
GRANT SELECT, INSERT, UPDATE ON awcms_reporting_projection_cursors TO awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_reporting_projection_metrics TO awcms_worker;
GRANT INSERT, UPDATE ON awcms_reporting_projection_state TO awcms_worker;
GRANT SELECT, UPDATE ON awcms_reporting_rebuild_runs TO awcms_worker;
GRANT SELECT ON awcms_reporting_scheduled_exports TO awcms_worker;
GRANT SELECT, INSERT ON awcms_reporting_export_runs TO awcms_worker;
-- Projection SOURCE tables — SELECT only (bounded incremental/rebuild scans).
GRANT SELECT ON awcms_abac_decision_logs TO awcms_worker;
GRANT SELECT ON awcms_identities TO awcms_worker;
GRANT SELECT ON awcms_sync_nodes TO awcms_worker;

-- ===========================================================================
-- 4. awcms_setup — EXACTLY what `bootstrapPlatformTenant`
-- (tenant-admin/platform-bootstrap.ts) writes on the one-time
-- POST /api/v1/setup/initialize. SELECT accompanies INSERT on every table it
-- inserts into WITH a RETURNING id (setup_state/tenants/offices/profiles/
-- identities/tenant_users/roles); the three INSERT-only tables have no
-- RETURNING and are never read back. Post-bootstrap this role's power to
-- create a SECOND tenant is inert at the app layer (the setup-state singleton
-- lock 403s any further call) — defense-in-depth on top of that lock.
-- ===========================================================================

-- Singleton lock: INSERT (claim, ON CONFLICT DO NOTHING) RETURNING id -> SELECT;
-- UPDATE tenant_id. Never deleted.
GRANT SELECT, INSERT, UPDATE ON awcms_setup_state TO awcms_setup;
-- Tenant root: INSERT ... RETURNING id -> SELECT + INSERT. Never updated/deleted
-- by the bootstrap (tenant-settings edits run as awcms_app at request time).
GRANT SELECT, INSERT ON awcms_tenants TO awcms_setup;
-- Read the global permission catalog to seed the owner role's permissions
-- (INSERT INTO awcms_role_permissions SELECT ... FROM awcms_permissions).
GRANT SELECT ON awcms_permissions TO awcms_setup;
-- INSERT-only, no RETURNING, not read back.
GRANT INSERT ON awcms_tenant_settings TO awcms_setup;
-- INSERT ... RETURNING id (each needs SELECT + INSERT).
GRANT SELECT, INSERT ON awcms_offices TO awcms_setup;
GRANT SELECT, INSERT ON awcms_profiles TO awcms_setup;
GRANT SELECT, INSERT ON awcms_identities TO awcms_setup;
GRANT SELECT, INSERT ON awcms_tenant_users TO awcms_setup;
GRANT SELECT, INSERT ON awcms_roles TO awcms_setup;
-- INSERT-only, no RETURNING.
GRANT INSERT ON awcms_role_permissions TO awcms_setup;
GRANT INSERT ON awcms_access_assignments TO awcms_setup;

COMMIT;
