-- visitor_analytics — permission catalog seed for the new
-- `visitor_analytics` module descriptor
-- (src/modules/visitor-analytics/module.ts). Ported from awcms-micro
-- migration 038 (rename `awcms_micro_` -> `awcms_`,
-- `awcms_micro_permissions` -> `awcms_permissions`). Same shape as
-- sql/047_awcms_tenant_domain_permissions.sql — extends the global ABAC
-- permission catalog only, no roles/access-assignments wired here, no new
-- tables (the visitor session/event/rollup schema lands in the next
-- migration, 050). Only tenants created AFTER this migration runs pick
-- these up automatically via the setup bootstrap's
-- `INSERT INTO awcms_role_permissions ... SELECT ... FROM awcms_permissions`
-- (same limitation every prior permission-seed migration has).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('visitor_analytics', 'dashboard', 'read', 'Read the visitor analytics dashboard'),
  ('visitor_analytics', 'realtime', 'read', 'Read real-time/online visitor counts'),
  ('visitor_analytics', 'sessions', 'read', 'Read visitor session records'),
  ('visitor_analytics', 'events', 'read', 'Read visitor page-view/event records'),
  ('visitor_analytics', 'raw_detail', 'read', 'Read raw visitor detail (IP address, user-agent) separate from aggregate dashboard access'),
  ('visitor_analytics', 'settings', 'read', 'Read visitor analytics module settings'),
  ('visitor_analytics', 'settings', 'update', 'Update visitor analytics module settings'),
  ('visitor_analytics', 'retention', 'purge', 'Purge visitor analytics data past its retention window')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
