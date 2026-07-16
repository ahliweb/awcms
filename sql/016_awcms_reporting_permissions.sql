-- Reporting module — permission catalog seed (ported from awcms-mini
-- migrations 010 + 070). `reporting.dashboard.read` gates the five live
-- `GET /api/v1/reports/*` aggregation views (tenant activity, access/audit,
-- sync health, module usage, email queue health). The six
-- `reporting.projections.*`/`reporting.exports.*` permissions gate the
-- module-contributed read-model projection/rebuild/reconcile/export
-- surface — verbatim match to `src/modules/reporting/domain/
-- projection-permissions.ts`'s `REPORTING_PROJECTION_PERMISSIONS` (the
-- single source of truth also reused by `module.ts`'s `permissions` array
-- and every route handler's `authorizeInTransaction` guard).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('reporting', 'dashboard', 'read', 'Read management reporting dashboard views (tenant activity, access/audit, sync health, module usage, email health)'),
  ('reporting', 'projections', 'read', 'Read a projection''s registry metadata, current snapshot value, and freshness status'),
  ('reporting', 'projections', 'rebuild', 'Trigger or resume a full projection rebuild'),
  ('reporting', 'projections', 'analyze', 'Trigger an on-demand reconciliation of a projection against its source control total'),
  ('reporting', 'exports', 'read', 'Read scheduled export configs, export run history, and download a completed export'),
  ('reporting', 'exports', 'configure', 'Create or disable a scheduled export config'),
  ('reporting', 'exports', 'export', 'Manually trigger an export run for a projection')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
