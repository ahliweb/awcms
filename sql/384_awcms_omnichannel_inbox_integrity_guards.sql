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
--   4. A customer state names the real event that set it, and the projector's
--      own role (awcms_worker) can write only what the projector writes, in
--      the conversation and in its history (the #1275 re-audit, N-1; below).
--
-- The activity ledger is append-only by GRANT (`sql/382` revokes UPDATE and
-- DELETE from awcms_app and awcms_worker); which KINDS the worker may append is
-- guarded below.

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

-- ---------------------------------------------------------------------------
-- The #1275 re-audit, N-1: what a LEAKED projector credential can do.
--
-- The domain-event dispatcher runs the projector as awcms_worker, so the
-- worker holds column-level writes on the conversation (sql/382). Column
-- grants say WHICH columns, not WHICH VALUES. Run as awcms_worker, the
-- auditor could: reopen a withdrawn conversation's work (P6, closed by the
-- CHECK in sql/382); freeze `customer_state_sequence` at the bigint maximum so
-- no later withdrawal could ever apply (P7); settle unanswered work without a
-- response (P8); move a conversation to another brand (P9); and forge
-- `response_recorded` / `assignee_revoked` / `sla_breached` history (P10).
-- The three guards below allow exactly what the projector writes, and no more.
--
-- "The worker" is MEMBERSHIP of awcms_worker for session_user or current_user
-- (sql/280's rule: a pooler login created IN ROLE awcms_worker is the worker
-- too). Only a CURRENT_USER that is a superuser is exempt (the migration, test
-- fixtures): unlike sql/280, a superuser SESSION that has done
-- `SET ROLE awcms_worker` is held to the worker's rules, because the role in
-- effect is what the grants already judge.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION awcms_inbox_is_superuser()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM pg_roles r WHERE r.rolname = current_user AND r.rolsuper
  );
$function$;

CREATE OR REPLACE FUNCTION awcms_inbox_is_worker()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT NOT awcms_inbox_is_superuser()
     AND (pg_has_role(session_user, 'awcms_worker', 'MEMBER')
          OR pg_has_role(current_user, 'awcms_worker', 'MEMBER'));
$function$;

-- (c) A customer state moves only to what a REAL, applicable customer-state
-- event of this conversation's own aggregate says, at that event's sequence
-- (P7). The predicate is `applicableCustomerStateEvent` (application/
-- customer-state-events.ts) in SQL: support consent opt_in/opt_out, or a
-- withdrawal, whose payload reference is the aggregate. One index probe on
-- `awcms_domain_events (event_sequence)`, and only when the state changes.
-- Every role but a superuser: awcms_app writes the state through the same
-- projector (rebuild, sweep). A new row starts `active` at sequence 0.
CREATE OR REPLACE FUNCTION awcms_inbox_conversations_state_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  expected text;
BEGIN
  IF awcms_inbox_is_superuser() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_state <> 'active' OR NEW.customer_state_sequence <> 0 THEN
      RAISE EXCEPTION 'an inbox conversation starts active at sequence 0'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.customer_state_sequence = OLD.customer_state_sequence THEN
    IF NEW.customer_state IS DISTINCT FROM OLD.customer_state THEN
      RAISE EXCEPTION 'an inbox customer state changes only with its event'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  SELECT CASE
           WHEN e.event_type = 'awcms.website_engagement.submission.withdrawn'
             THEN 'withdrawn'
           WHEN e.payload->>'action' = 'opt_out' THEN 'opted_out'
           ELSE 'active'
         END
    INTO expected
    FROM awcms_domain_events e
   WHERE e.event_sequence = NEW.customer_state_sequence
     AND e.tenant_id = NEW.tenant_id
     AND e.aggregate_id = NEW.source_ref
     AND (
       (
         NEW.source_kind = 'telegram'
         AND e.event_type = 'awcms.telegram_engagement.consent.changed'
         AND e.aggregate_type = 'telegram_engagement_contact'
         AND e.payload->>'purpose' = 'support'
         AND e.payload->>'action' IN ('opt_in', 'opt_out')
         AND lower(e.payload->>'contactRef') = e.aggregate_id::text
       )
       OR (
         NEW.source_kind = 'website'
         AND e.event_type = 'awcms.website_engagement.submission.withdrawn'
         AND e.aggregate_type = 'website_engagement_submission'
         AND lower(e.payload->>'submissionId') = e.aggregate_id::text
       )
     );

  IF expected IS NULL OR expected <> NEW.customer_state THEN
    RAISE EXCEPTION 'an inbox customer state must name the event that set it'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_conversations_state_provenance
  ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_state_provenance
  BEFORE INSERT OR UPDATE ON awcms_inbox_conversations
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_conversations_state_provenance();

-- The worker's writes are exactly the projector's (P8, P9 and a breach stamp):
--   * the business scope is the channel account's CURRENT scope (a website
--     conversation has none), on insert and on every change;
--   * the status moves only to `open` (an unanswered inbound reopens settled,
--     still-active work) or to `closed` together with a withdrawal;
--   * `answered_through` moves only with the withdrawal that closes it;
--   * the wait is cleared only when the customer no longer owes an answer;
--   * `sla_breached_at` can only be cleared, never stamped (the SLA job, on
--     awcms_app, stamps it).
-- Left to the worker, by necessity: starting a wait and a due time, reopening
-- active settled work, moving `version`. Each is something a real inbound
-- envelope does; telling a forged one apart would need the event, which a
-- grant cannot carry (README "Open decisions").
CREATE OR REPLACE FUNCTION awcms_inbox_conversations_worker_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  account_scope_type text;
  account_scope_id uuid;
BEGIN
  IF NOT awcms_inbox_is_worker() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
     OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
    IF NEW.channel_account_id IS NOT NULL THEN
      SELECT a.business_scope_type, a.business_scope_id
        INTO account_scope_type, account_scope_id
        FROM awcms_channel_accounts a
       WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.channel_account_id;
    END IF;

    IF NEW.business_scope_type IS DISTINCT FROM account_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM account_scope_id THEN
      RAISE EXCEPTION 'awcms_inbox: WORKER_SCOPE_IS_THE_ACCOUNT_SCOPE'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (
       (NEW.status = 'open' AND OLD.status IN ('resolved', 'closed')
        AND NEW.customer_state = 'active')
       OR (NEW.status = 'closed' AND NEW.customer_state = 'withdrawn')
     ) THEN
    RAISE EXCEPTION 'awcms_inbox: WORKER_STATUS_ONLY_REOPEN_OR_WITHDRAW'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.answered_through IS DISTINCT FROM OLD.answered_through
     AND NOT (NEW.customer_state = 'withdrawn'
              AND OLD.customer_state <> 'withdrawn') THEN
    RAISE EXCEPTION 'awcms_inbox: WORKER_ANSWERED_ONLY_ON_WITHDRAWAL'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.awaiting_since IS NOT NULL AND NEW.awaiting_since IS NULL
     AND NEW.customer_state = 'active' THEN
    RAISE EXCEPTION 'awcms_inbox: WORKER_WAIT_CLEARED_ONLY_WHEN_NOTHING_OWED'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.sla_breached_at IS DISTINCT FROM OLD.sla_breached_at
     AND NEW.sla_breached_at IS NOT NULL THEN
    RAISE EXCEPTION 'awcms_inbox: WORKER_CANNOT_STAMP_A_BREACH'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_conversations_worker_guard
  ON awcms_inbox_conversations;
CREATE TRIGGER awcms_inbox_conversations_worker_guard
  BEFORE INSERT OR UPDATE ON awcms_inbox_conversations
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_conversations_worker_guard();

-- (b) The only history the projector writes is the reopen row
-- (`status_changed` / `open`, system-attributed). Anything else from the
-- worker is a forgery (P10).
CREATE OR REPLACE FUNCTION awcms_inbox_activity_worker_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF awcms_inbox_is_worker()
     AND NOT (NEW.kind = 'status_changed'
              AND NEW.detail_code = 'open'
              AND NEW.actor_tenant_user_id IS NULL
              AND NEW.subject_tenant_user_id IS NULL) THEN
    RAISE EXCEPTION 'awcms_inbox: WORKER_ACTIVITY_ONLY_REOPEN'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_inbox_activity_worker_guard ON awcms_inbox_activity;
CREATE TRIGGER awcms_inbox_activity_worker_guard
  BEFORE INSERT ON awcms_inbox_activity
  FOR EACH ROW EXECUTE FUNCTION awcms_inbox_activity_worker_guard();
