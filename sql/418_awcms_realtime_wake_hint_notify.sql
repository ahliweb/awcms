-- Cross-instance wake-up hint for the realtime progress streams (Issue #1171,
-- ADR-0154 section 2 and 7).
--
-- Additive and forward-only (ADR-0148 I13): one trigger function and three
-- triggers. No table, no column, no grant, no permission.
--
-- A stream is a projection of durable rows and re-reads PostgreSQL on its own
-- tick, so it is correct on any number of instances. What a replica cannot do
-- on its own is learn, before its next tick, that ANOTHER instance (or a worker
-- job) committed a change. This migration makes the writer say so:
--
--   pg_notify('awcms_realtime', '{"t":"<tenant uuid>","k":"<topic>"}')
--
-- Properties that matter, and the tests that pin them
-- (`tests/integration/realtime-wake-hint.integration.test.ts`):
--
--   - The payload is exactly a tenant id and a topic name. No row id, no
--     conversation or message field, no counter, no text: nothing personal can
--     reach the channel, and it is two orders of magnitude under the 8000-byte
--     NOTIFY limit.
--   - NOTIFY is queued by the writing transaction and delivered AT COMMIT, so a
--     woken stream reads data that is already visible. A rolled-back write
--     notifies nobody. Identical payloads inside one transaction collapse into
--     one notification, so a broadcast finalising a thousand rows is one hint.
--   - A hint is NOT trusted for anything: the receiving stream still runs its
--     own authorization and reads from its cursor. A forged or lost hint costs
--     latency or one redundant read.
--   - The function is SECURITY INVOKER with a pinned search_path and a
--     schema-qualified `pg_notify`: it grants its caller nothing and an
--     attacker-controlled schema cannot intercept the call.
--
-- Triggers fire only for changes a topic's counters or change list depend on,
-- so unrelated updates (a retry-attempt bookkeeping column, a note edit) do not
-- wake anyone.
CREATE OR REPLACE FUNCTION awcms_realtime_wake_hint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  -- TG_ARGV[0] is the topic, fixed in the CREATE TRIGGER below; it is never
  -- derived from the row.
  PERFORM pg_catalog.pg_notify(
    'awcms_realtime',
    pg_catalog.jsonb_build_object('t', NEW.tenant_id, 'k', TG_ARGV[0])::text
  );

  RETURN NULL;
END;
$function$;

-- whatsapp.sender.progress: the counters are per status.
DROP TRIGGER IF EXISTS awcms_whatsapp_messages_wake_insert
  ON awcms_whatsapp_messages;
CREATE TRIGGER awcms_whatsapp_messages_wake_insert
  AFTER INSERT ON awcms_whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_realtime_wake_hint('whatsapp.sender.progress');

DROP TRIGGER IF EXISTS awcms_whatsapp_messages_wake_update
  ON awcms_whatsapp_messages;
CREATE TRIGGER awcms_whatsapp_messages_wake_update
  AFTER UPDATE ON awcms_whatsapp_messages
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        OR OLD.updated_at IS DISTINCT FROM NEW.updated_at)
  EXECUTE FUNCTION awcms_realtime_wake_hint('whatsapp.sender.progress');

-- inbox.status.progress: the counters read status, assignee, awaiting and SLA
-- columns and the business scope; the change list keys on updated_at.
DROP TRIGGER IF EXISTS awcms_inbox_conversations_wake_insert
  ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_wake_insert
  AFTER INSERT ON awcms_inbox_conversations
  FOR EACH ROW
  EXECUTE FUNCTION awcms_realtime_wake_hint('inbox.status.progress');

DROP TRIGGER IF EXISTS awcms_inbox_conversations_wake_update
  ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_wake_update
  AFTER UPDATE ON awcms_inbox_conversations
  FOR EACH ROW
  WHEN ((OLD.status, OLD.assignee_tenant_user_id, OLD.awaiting_since,
         OLD.response_due_at, OLD.sla_breached_at, OLD.business_scope_id,
         OLD.updated_at)
        IS DISTINCT FROM
        (NEW.status, NEW.assignee_tenant_user_id, NEW.awaiting_since,
         NEW.response_due_at, NEW.sla_breached_at, NEW.business_scope_id,
         NEW.updated_at))
  EXECUTE FUNCTION awcms_realtime_wake_hint('inbox.status.progress');
