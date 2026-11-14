-- Realtime work counts of the omnichannel inbox (Issue #1171, ADR-0154).
--
-- Additive and forward-only (ADR-0148 I13): one permission, two indexes. No new
-- table, no new queue: the stream is a projection of `awcms_inbox_conversations`
-- (Issue #1164, ADR-0160).
--
--   status.read   watch the inbox's live work counts (open, pending, awaiting a
--                 reply, unassigned, SLA breached) and the ids and statuses of
--                 conversations that changed, within the business scopes the
--                 caller covers. Enforced by GET /api/v1/omnichannel-inbox/progress
--                 (REST snapshot) and GET /api/v1/omnichannel-inbox/progress/stream
--                 (SSE), both added in this change (the seed-gap trap in
--                 AGENTS.md: a permission nothing seeds denies even `owner`).
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
--
-- ## Deploy note
--
-- No `CONCURRENTLY`: the migration runner wraps each file in a transaction. A
-- plain `CREATE INDEX` takes a SHARE lock on `awcms_inbox_conversations` while
-- it builds; the table holds one row per customer conversation inside the
-- retention window (thousands, not millions), so the wait is short. See
-- `docs/awcms/realtime-progress-streams.md` (Deploy).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('omnichannel_inbox', 'status', 'read',
   'Watch the inbox''s live work counts (open, pending, awaiting a reply, unassigned, SLA breached) and which conversations changed, within the business scopes the caller covers; ids, statuses and times only, never a message body or a customer identifier')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- The stream's keyset: "what changed after (updated_at, id)", in order. The
-- scope columns are carried so a caller confined to business scopes is
-- filtered from the index, not from the heap.
CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_progress_idx
  ON awcms_inbox_conversations (tenant_id, updated_at, id)
  INCLUDE (status, business_scope_type, business_scope_id);

-- The bounded counts: only ACTIVE work (open or pending) is counted, so the
-- cost of a tick follows the work in progress, not the retention window.
CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_active_work_idx
  ON awcms_inbox_conversations (tenant_id)
  INCLUDE (status, assignee_tenant_user_id, awaiting_since, response_due_at,
           sla_breached_at, business_scope_type, business_scope_id)
  WHERE status IN ('open', 'pending');
