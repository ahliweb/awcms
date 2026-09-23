-- ADR-0122 / Issue ahliweb/omes#196 — OMES Control Center permission catalog seed.
--
-- Seeds the default-deny permission catalog entries for the omes_control module.
-- Permissions cover server fleet inventory, enrollment management, deployments,
-- worker job lifecycle/approval, backup verification & recovery, and audit inspection.
--
-- `awcms_permissions` is a global table (no tenant_id / no RLS).
-- Idempotent via ON CONFLICT (module_key, activity_code, action) DO NOTHING.

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omes_control', 'servers', 'read', 'Read enrolled servers, host specs, and telemetry'),
  ('omes_control', 'servers', 'register', 'Register or enroll a new OMES server'),
  ('omes_control', 'servers', 'delete', 'Remove or decommission an enrolled server'),
  ('omes_control', 'deployments', 'read', 'Read desired, observed, and reconciliation deployment state'),
  ('omes_control', 'deployments', 'operate', 'Apply, update, reconcile, or roll back server deployments'),
  ('omes_control', 'jobs', 'read', 'Read dispatched, queued, and completed OMES worker jobs'),
  ('omes_control', 'jobs', 'approve', 'Approve mutating or high-risk OMES jobs'),
  ('omes_control', 'jobs', 'cancel', 'Cancel queued or leased OMES jobs'),
  ('omes_control', 'backups', 'read', 'Read backup snapshots and verification checksums'),
  ('omes_control', 'backups', 'restore', 'Restore server or agent state from backup snapshot'),
  ('omes_control', 'backups', 'rollback', 'Trigger emergency rollback to prior known-good state'),
  ('omes_control', 'audit', 'read', 'Read OMES execution and reconciliation audit evidence'),
  ('omes_control', 'enrollments', 'manage', 'Manage worker enrollment tokens and public key credentials')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
