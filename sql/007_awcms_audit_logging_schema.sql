CREATE TABLE IF NOT EXISTS awcms_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  actor_tenant_user_id uuid,
  module_key text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  severity text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  attributes jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_audit_events_severity_check
    CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE INDEX IF NOT EXISTS awcms_audit_events_tenant_created_idx
  ON awcms_audit_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_audit_events_tenant_resource_idx
  ON awcms_audit_events (tenant_id, resource_type, resource_id);

ALTER TABLE awcms_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_audit_events_tenant_isolation
  ON awcms_audit_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('logging', 'audit_trail', 'read', 'Read audit trail events')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
