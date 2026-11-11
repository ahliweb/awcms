-- Realtime delivery progress of a WhatsApp sender (Issue #1171, ADR-0154).
--
-- Additive and forward-only (ADR-0148 I13): one permission, two indexes. No new
-- table, no new queue: the stream is a projection of `awcms_whatsapp_messages`.
--
--   progress.read   watch one sender's delivery progress: counts per status and
--                   the ids and statuses of messages that changed. Enforced by
--                   GET /api/v1/whatsapp/senders/{id}/progress (REST snapshot)
--                   and GET /api/v1/whatsapp/senders/{id}/progress/stream (SSE),
--                   both added in this change (the seed-gap trap in AGENTS.md: a
--                   permission nothing seeds denies even `owner`).
--
-- Same limitation as every prior permission-seed migration: this extends the
-- GLOBAL catalog only; a tenant created earlier needs
-- `bun run identity-access:permissions:backfill`.
--
-- ## Deploy note: these indexes lock writes to the queue while they build
--
-- No `CONCURRENTLY`: the migration runner (`scripts/db-migrate.ts`) wraps each
-- file in a transaction, and `CREATE INDEX CONCURRENTLY` cannot run inside one
-- (the same constraint `sql/143` records). A plain `CREATE INDEX` takes a SHARE
-- lock on `awcms_whatsapp_messages`: enqueues and dispatcher finalisations WAIT
-- until both builds finish. On a large queue, run this migration in a quiet
-- window, or stop `whatsapp:dispatch` for its duration (callers that enqueue in
-- their own transaction wait rather than fail). Both indexes are partial
-- (`sender_account_id IS NOT NULL`), so a deployment that never routes through
-- a named sender builds them over zero rows. See
-- `docs/awcms/realtime-progress-streams.md` (Deploy).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('whatsapp_delivery', 'progress', 'read',
   'Watch one WhatsApp sender''s delivery progress live (counts per status and message ids with their status; never a number, a body or a provider response)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- The stream's keyset: "what changed for this sender after (updated_at, id)",
-- in order. The scope columns are carried so a caller confined to business
-- scopes is filtered from the index, not from the heap.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_sender_progress_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, updated_at, id)
  INCLUDE (status, business_scope_type, business_scope_id)
  WHERE sender_account_id IS NOT NULL;

-- The bounded counts: messages of this sender created in the counting window
-- (seven days, `WHATSAPP_PROGRESS_COUNT_WINDOW_DAYS`), counted per status from
-- an index (index-only once the visibility map is set).
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_sender_window_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, created_at)
  INCLUDE (status, business_scope_type, business_scope_id)
  WHERE sender_account_id IS NOT NULL;
