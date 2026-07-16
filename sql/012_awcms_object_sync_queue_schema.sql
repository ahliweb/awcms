-- Sync Storage — object sync queue for local objects awaiting upload to
-- object storage (R2 or compatible). Ported from awcms-mini `sync-storage`
-- migration 009, with the performance indexes from 017 and the transient
-- `sending` dispatcher status from 018 folded into the final coherent schema.

CREATE TABLE IF NOT EXISTS awcms_object_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  node_id uuid NOT NULL REFERENCES awcms_sync_nodes (id),
  object_key text NOT NULL,
  local_path text NOT NULL,
  checksum_sha256 text NOT NULL,
  byte_size bigint NOT NULL,
  requires_upload boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  retry_count integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz,
  last_error text,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- `sending` is a transient claim status used by the internal dispatcher
  -- (application/object-dispatch.ts) with next_retry_at reused as a lease
  -- expiry; it is never a terminal or client-visible enqueue status.
  CONSTRAINT awcms_object_sync_queue_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT awcms_object_sync_queue_byte_size_check
    CHECK (byte_size >= 0)
);

-- Upsert key (tenant_id, node_id, object_key) covers both FK columns.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_object_sync_queue_key
  ON awcms_object_sync_queue (tenant_id, node_id, object_key);

-- Dispatcher retry/claim scan by (tenant_id, status, next_retry_at).
CREATE INDEX IF NOT EXISTS awcms_object_sync_queue_retry_idx
  ON awcms_object_sync_queue (tenant_id, status, next_retry_at);

-- Admin listing shapes (mini migration 017 performance audit): tenant-wide
-- newest-first, status-filtered newest-first, and the node-scoped status poll.
CREATE INDEX IF NOT EXISTS awcms_object_sync_queue_tenant_created_idx
  ON awcms_object_sync_queue (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_object_sync_queue_tenant_status_created_idx
  ON awcms_object_sync_queue (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_object_sync_queue_tenant_node_created_idx
  ON awcms_object_sync_queue (tenant_id, node_id, created_at);

ALTER TABLE awcms_object_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY awcms_object_sync_queue_tenant_isolation
  ON awcms_object_sync_queue
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permissions for the session-authenticated admin object queue endpoints
-- (`GET /api/v1/sync/object-queue`, `POST /api/v1/sync/object-queue/{id}/retry`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('sync_storage', 'object_queue', 'read', 'Read object sync queue entries'),
  ('sync_storage', 'object_queue', 'retry', 'Manually retry a failed object sync queue entry')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
