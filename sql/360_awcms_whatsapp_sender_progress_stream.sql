-- Realtime delivery progress of a WhatsApp sender (Issue #1171, ADR-0154).
--
-- Additive and forward-only (ADR-0148 I13): one permission, one index. No new
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
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('whatsapp_delivery', 'progress', 'read',
   'Watch one WhatsApp sender''s delivery progress live (counts per status and message ids with their status; never a number, a body or a provider response)')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

-- The stream's keyset: "what changed for this sender after (updated_at, id)",
-- in order. Partial like the other sender indexes, since the deployment sender
-- (NULL) is not a streamable resource.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_sender_progress_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, updated_at, id)
  WHERE sender_account_id IS NOT NULL;
