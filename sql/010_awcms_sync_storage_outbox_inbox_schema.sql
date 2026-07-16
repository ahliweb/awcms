-- Sync Storage — outbox/inbox event exchange + node registry (ported from
-- awcms-mini `sync-storage` migrations 007 + the push-batch conflict column
-- from 008 + node-management permission seeds from 014, consolidated into one
-- coherent schema for this repo). All tables are tenant-scoped with RLS.

CREATE TABLE IF NOT EXISTS awcms_sync_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  node_code text NOT NULL,
  node_name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_pushed_at timestamptz,
  last_pulled_at timestamptz,
  last_pull_sequence bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sync_nodes_status_check
    CHECK (status IN ('active', 'inactive'))
);

-- Unique (tenant_id, node_code) doubles as the tenant_id FK index.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_sync_nodes_tenant_code_key
  ON awcms_sync_nodes (tenant_id, node_code);

ALTER TABLE awcms_sync_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_nodes_tenant_isolation
  ON awcms_sync_nodes
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  node_id uuid REFERENCES awcms_sync_nodes (id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sync_outbox_status_check
    CHECK (status IN ('pending', 'delivered'))
);

-- Unique (tenant_id, sequence) is the pull cursor index and covers the
-- tenant_id FK; a separate index covers the node_id FK.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_sync_outbox_tenant_sequence_key
  ON awcms_sync_outbox (tenant_id, sequence);

CREATE INDEX IF NOT EXISTS awcms_sync_outbox_node_idx
  ON awcms_sync_outbox (node_id);

ALTER TABLE awcms_sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_outbox_tenant_isolation
  ON awcms_sync_outbox
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_sync_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  node_id uuid NOT NULL REFERENCES awcms_sync_nodes (id),
  batch_id text NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sync_inbox_status_check
    CHECK (status IN ('received', 'applied', 'rejected'))
);

-- Composite (tenant_id, node_id) covers both FK columns.
CREATE INDEX IF NOT EXISTS awcms_sync_inbox_tenant_node_idx
  ON awcms_sync_inbox (tenant_id, node_id);

ALTER TABLE awcms_sync_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_inbox_tenant_isolation
  ON awcms_sync_inbox
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_sync_push_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  node_id uuid NOT NULL REFERENCES awcms_sync_nodes (id),
  batch_id text NOT NULL,
  event_count integer NOT NULL,
  conflicted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sync_push_batches_event_count_check
    CHECK (event_count >= 0)
);

-- Idempotency ledger key (tenant_id, node_id, batch_id) covers both FKs.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_sync_push_batches_key
  ON awcms_sync_push_batches (tenant_id, node_id, batch_id);

ALTER TABLE awcms_sync_push_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_sync_push_batches_tenant_isolation
  ON awcms_sync_push_batches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permissions for the session-authenticated admin sync node endpoints
-- (`GET /api/v1/sync/nodes`, `PATCH /api/v1/sync/nodes/{id}`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('sync_storage', 'node_management', 'read', 'Read sync node registrations'),
  ('sync_storage', 'node_management', 'update', 'Activate/deactivate or rename a sync node')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
