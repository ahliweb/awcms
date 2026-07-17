-- Enforce RLS on the 23 tenant-scoped tables that only `ENABLE`d it (ported
-- from awcms-mini migration 013_awcms_mini_enforce_rls_least_privilege.sql,
-- part 1 of 2).
--
-- FINDING: the multi-tenant RLS control (ADR-0003) was inert for these
-- tables. Migrations 002-008 and 010-012 only `ENABLE ROW LEVEL SECURITY`;
-- PostgreSQL bypasses RLS for a table's OWNER unless `FORCE` is set, and the
-- app connects as the migration owner via `DATABASE_URL` (stated outright in
-- the header of 014). So the `awcms_*_tenant_isolation` policies on these
-- tables were never evaluated: tenant isolation rested entirely on the
-- application's `WHERE tenant_id` clauses, with RLS as a non-functioning
-- backstop. Migrations 009 and 013-015 already set `FORCE` (48 tables
-- `ENABLE`, 25 `FORCE`), which is why this looked like a settled convention
-- rather than a gap — the header of 014 asserts the convention holds "since
-- migration 002", which was not true.
--
-- Every table below already has `tenant_id` and a tenant-isolation policy, so
-- this only starts enforcing what was already declared. All access paths go
-- through `withTenant()` (which issues `SET LOCAL app.current_tenant_id`), so
-- no read/write path loses rows: `scripts/object-sync-dispatch.ts` is the only
-- worker touching one of these tables outside a request, and its own raw query
-- reads `awcms_tenants` (the root table, deliberately without RLS) while the
-- queue work goes through `dispatchObjectSyncQueue` -> `withTenant`.
--
-- SCOPE — this closes the OWNER bypass only. A connection with SUPERUSER or
-- BYPASSRLS still bypasses RLS regardless of `FORCE`. Closing that requires
-- part 2 of mini's migration: a least-privilege `awcms_app` role plus a
-- fail-closed default GUC, which this base does not have yet (no `CREATE ROLE`
-- or `GRANT` exists anywhere in sql/, and `src/lib/database/client.ts` cites a
-- `sql/045_awcms_db_role_separation.sql` that does not exist). Tracked
-- separately, because introducing a role is a deployment-affecting change.

BEGIN;

ALTER TABLE awcms_offices FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_profile_identifiers FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_profile_entity_links FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_tenant_users FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sessions FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_access_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_abac_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_abac_decision_logs FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_audit_events FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_tenant_modules FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_module_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_sync_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sync_outbox FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sync_inbox FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sync_push_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sync_aggregate_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE awcms_sync_conflicts FORCE ROW LEVEL SECURITY;

ALTER TABLE awcms_object_sync_queue FORCE ROW LEVEL SECURITY;

COMMIT;
