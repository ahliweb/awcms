-- omnichannel_inbox -- integrity guards (Issue #1164, ADR-0160).
--
-- Refusals that hold whatever the application does:
--
--   1. A conversation's identity (tenant, source kind, opaque reference,
--      channel account, creation time) is immutable, and a WITHDRAWN customer
--      state is terminal: a withdrawn website submission can never be revived
--      by a replayed event or an operator.
--   2. An SLA policy's terms are immutable; the only change is active ->
--      retired (a new policy is a new row, so a breach always names the terms
--      it was measured against).
--   3. A conversation carries at most 20 tags, and only LIVE tags of its own
--      tenant can be linked (the composite FK already pins the tenant).
--
-- The activity ledger is append-only by GRANT (`sql/382` revokes UPDATE and
-- DELETE from awcms_app); no trigger is needed for it.

CREATE OR REPLACE FUNCTION awcms_inbox_conversations_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.channel_account_id IS DISTINCT FROM OLD.channel_account_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'an inbox conversation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.customer_state = 'withdrawn'
     AND NEW.customer_state IS DISTINCT FROM 'withdrawn' THEN
    RAISE EXCEPTION 'a withdrawn inbox conversation is terminal'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.customer_state_sequence < OLD.customer_state_sequence THEN
    RAISE EXCEPTION 'an inbox customer state cannot move back in event order'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_conversations_guard ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_guard
  BEFORE UPDATE ON awcms_inbox_conversations
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_conversations_guard();

CREATE OR REPLACE FUNCTION awcms_inbox_sla_policies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
     OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.first_response_minutes IS DISTINCT FROM OLD.first_response_minutes
     OR NEW.next_response_minutes IS DISTINCT FROM OLD.next_response_minutes
     OR NEW.working_hours IS DISTINCT FROM OLD.working_hours
     OR NEW.holidays IS DISTINCT FROM OLD.holidays
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'inbox SLA policy terms are immutable; create a new policy'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'retired' AND (
       NEW.status IS DISTINCT FROM 'retired'
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
       OR NEW.retired_by IS DISTINCT FROM OLD.retired_by
     ) THEN
    RAISE EXCEPTION 'a retired inbox SLA policy is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_sla_policies_guard ON awcms_inbox_sla_policies;
CREATE TRIGGER awcms_inbox_sla_policies_guard
  BEFORE UPDATE ON awcms_inbox_sla_policies
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_sla_policies_guard();

CREATE OR REPLACE FUNCTION awcms_inbox_conversation_tags_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  linked integer;
BEGIN
  -- Serialise links to one conversation so two concurrent writers cannot both
  -- pass the cap.
  PERFORM 1 FROM awcms_inbox_conversations
   WHERE tenant_id = NEW.tenant_id AND id = NEW.conversation_id
   FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM awcms_inbox_tags
     WHERE tenant_id = NEW.tenant_id AND id = NEW.tag_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'only a live inbox tag can be linked'
      USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO linked FROM awcms_inbox_conversation_tags
   WHERE tenant_id = NEW.tenant_id AND conversation_id = NEW.conversation_id;

  IF linked >= 20 THEN
    RAISE EXCEPTION 'an inbox conversation carries at most 20 tags'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_conversation_tags_guard ON awcms_inbox_conversation_tags;
CREATE TRIGGER awcms_inbox_conversation_tags_guard
  BEFORE INSERT ON awcms_inbox_conversation_tags
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_conversation_tags_guard();
