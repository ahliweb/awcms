-- Sync Storage — optimistic-concurrency conflict tracking (ported from
-- awcms-mini `sync-storage` migration 008 + the conflict listing index from
-- 017). Server-side aggregate version registry + immutable conflict records.

CREATE TABLE IF NOT EXISTS awcms_sync_aggregate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  current_version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique (tenant_id, aggregate_type, aggregate_id) covers the tenant_id FK.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_sync_aggregate_versions_key
  ON awcms_sync_aggregate_versions (tenant_id, aggregate_type, aggregate_id);

ALTER TABLE awcms_sync_aggregate_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_aggregate_versions_tenant_isolation
  ON awcms_sync_aggregate_versions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  node_id uuid NOT NULL REFERENCES awcms_sync_nodes (id),
  batch_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  conflict_type text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sync_conflicts_conflict_type_check
    CHECK (conflict_type IN ('version_mismatch', 'missing_base_version')),
  CONSTRAINT awcms_sync_conflicts_status_check
    CHECK (status IN ('open', 'resolved')),
  CONSTRAINT awcms_sync_conflicts_resolution_check
    CHECK (resolution IS NULL OR resolution IN ('accept_incoming', 'keep_existing', 'manual'))
);

-- Listing by (tenant_id, status, created_at DESC) for the filtered admin view,
-- plus (tenant_id, created_at DESC) for the unfiltered view (mini migration
-- 017 performance audit). A dedicated (tenant_id, node_id) index covers the
-- node_id FK.
CREATE INDEX IF NOT EXISTS awcms_sync_conflicts_tenant_status_idx
  ON awcms_sync_conflicts (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_sync_conflicts_tenant_created_idx
  ON awcms_sync_conflicts (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_sync_conflicts_tenant_node_idx
  ON awcms_sync_conflicts (tenant_id, node_id);

ALTER TABLE awcms_sync_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_conflicts_tenant_isolation
  ON awcms_sync_conflicts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permissions for the session-authenticated conflict endpoints
-- (`GET /api/v1/sync/conflicts`, `POST /api/v1/sync/conflicts/{id}/resolve`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('sync_storage', 'conflict_resolution', 'read', 'Read sync conflicts'),
  ('sync_storage', 'conflict_resolution', 'approve', 'Resolve sync conflicts')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
