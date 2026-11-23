-- Cross-instance wake-up hint for the realtime progress streams (Issue #1171,
-- ADR-0154 section 2 and 7).
--
-- Additive and forward-only (ADR-0148 I13): one trigger function and four
-- triggers. No table, no column, no grant, no permission.
--
-- A stream is a projection of durable rows and re-reads PostgreSQL on its own
-- tick, so it is correct on any number of instances. What a replica cannot do
-- on its own is learn, before its next tick, that ANOTHER instance (or a worker
-- job) committed a change. This migration lets the writer say so:
--
--   pg_notify('awcms_realtime', '{"t":"<tenant uuid>","k":"<topic>"}')
--
-- ## OFF BY DEFAULT, and the switch lives in the database
--
-- Measured on one shared PostgreSQL 18 machine (pgbench, 16 clients), a commit
-- that carries a NOTIFY is serialised on the notification queue lock: about
-- 2 000 to 3 000 commits/s with NOTIFY against 5 400 to 13 000 without, and that
-- cost is paid with or without a listener. So the hint ships DISABLED, and is
-- turned on only after the same measurement in the target environment:
--
--   ALTER DATABASE <db> SET awcms.realtime_wake = 'on';   -- new sessions
--   ALTER DATABASE <db> RESET awcms.realtime_wake;        -- off again
--
-- (`ALTER ROLE <role> SET ...` works the same for one writer role.) The GUC is
-- tested in each trigger's WHEN clause, so while it is not 'on' the executor
-- skips the trigger without calling the function; the function tests it again
-- as the second line. Flipping it needs no deploy and no restart, only new
-- sessions. The process side has its own switch (`REALTIME_WAKE_HINT_ENABLED`,
-- also default off); both must be on for a hint to travel.
--
-- ## Properties, and the tests that pin them
-- (`tests/integration/realtime-wake-hint.integration.test.ts`)
--
--   - The payload is exactly a tenant id and a topic name. No row id, no
--     conversation or message field, no counter, no text: nothing personal can
--     reach the channel, and it is two orders of magnitude under the 8000-byte
--     NOTIFY limit.
--   - NOTIFY is queued by the writing transaction and delivered AT COMMIT, so a
--     woken stream reads data that is already visible. A rolled-back write
--     notifies nobody. Identical payloads inside ONE transaction collapse into
--     one notification; across transactions they do not, so a sustained write
--     rate is a sustained NOTIFY rate (see the cost above).
--   - A hint is NOT trusted for anything: the receiving stream still runs its
--     own authorization and reads from its cursor. A forged or lost hint costs
--     latency or one redundant read.
--   - The function is SECURITY INVOKER with a pinned search_path and a
--     schema-qualified `pg_notify`: it grants its caller nothing and an
--     attacker-controlled schema cannot intercept the call.
--
-- ## Why row-level triggers and not statement-level with transition tables
--
-- Tried and measured (100 000 single-row UPDATEs, hint OFF): statement-level
-- triggers with `REFERENCING OLD TABLE / NEW TABLE` cost about 39% more than no
-- trigger, because PostgreSQL captures the transition tables whether or not the
-- trigger's WHEN clause is true; the row-level triggers below cost between 7%
-- and 20% (noise level on that machine) because their WHEN clause is evaluated
-- first and the function is never entered. The saving transition tables would
-- bring when ON (one NOTIFY per distinct tenant per statement instead of one
-- per row, which the in-transaction dedupe already gives) does not repay a
-- cost paid by every deployment that never turns the hint on.
--
-- ## What wakes whom
--
-- whatsapp.sender.progress counts messages by STATUS, so only an INSERT or a
-- status transition notifies. Bookkeeping updates that leave the status alone
-- (a lease renewal, an attempt counter, `updated_at` alone) notify nobody.
-- inbox.status.progress counts status, assignee, awaiting and SLA columns and
-- the business scope, and lists changes by `updated_at`, so a change to any of
-- those notifies.
CREATE OR REPLACE FUNCTION awcms_realtime_wake_hint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $function$
BEGIN
  -- Second line of the switch (the triggers' WHEN clause is the first).
  IF pg_catalog.current_setting('awcms.realtime_wake', true)
       IS DISTINCT FROM 'on' THEN
    RETURN NULL;
  END IF;

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
  WHEN (pg_catalog.current_setting('awcms.realtime_wake', true) = 'on')
  EXECUTE FUNCTION awcms_realtime_wake_hint('whatsapp.sender.progress');

DROP TRIGGER IF EXISTS awcms_whatsapp_messages_wake_update
  ON awcms_whatsapp_messages;
CREATE TRIGGER awcms_whatsapp_messages_wake_update
  AFTER UPDATE ON awcms_whatsapp_messages
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status
        AND pg_catalog.current_setting('awcms.realtime_wake', true) = 'on')
  EXECUTE FUNCTION awcms_realtime_wake_hint('whatsapp.sender.progress');

-- inbox.status.progress: the counters read status, assignee, awaiting and SLA
-- columns and the business scope; the change list keys on updated_at.
DROP TRIGGER IF EXISTS awcms_inbox_conversations_wake_insert
  ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_wake_insert
  AFTER INSERT ON awcms_inbox_conversations
  FOR EACH ROW
  WHEN (pg_catalog.current_setting('awcms.realtime_wake', true) = 'on')
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
         NEW.updated_at)
        AND pg_catalog.current_setting('awcms.realtime_wake', true) = 'on')
  EXECUTE FUNCTION awcms_realtime_wake_hint('inbox.status.progress');
