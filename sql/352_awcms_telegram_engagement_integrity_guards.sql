-- telegram_engagement -- integrity guards (Issue #1156, ADR-0152).
--
-- Refusals that hold whatever the application does:
--
--   1. An endpoint's identity (tenant, account, callback hash) is immutable, a
--      revoked endpoint is terminal (rotation creates a NEW row: the old callback
--      token and secret stop working for good, ADR-0152 section 3), and the
--      endpoint's bot must be a live `telegram` / `bot` channel account of the
--      same tenant.
--   2. A contact's identity (tenant, account, keyed hash) is immutable and an
--      ended contact is terminal: the erased chat ciphertext can never be
--      written back.
--   3. An outbound message's snapshot (tenant, account, contact, purpose, kind,
--      consent evidence, prompt) is immutable, and a terminal status
--      (`sent`, `uncertain`, `failed`, `cancelled`) never changes again (an
--      uncertain send is not blindly retried, ADR-0152 TG10).
--
-- The consent ledger and the inbound receipts are append-only by GRANT
-- (`sql/350` revokes UPDATE from awcms_app); no trigger is needed for them.

CREATE OR REPLACE FUNCTION awcms_telegram_engagement_endpoints_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  account_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.callback_hash IS DISTINCT FROM OLD.callback_hash
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'a telegram engagement endpoint identity is immutable'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.state = 'revoked' AND (
         NEW.state IS DISTINCT FROM 'revoked'
         OR NEW.secret_id IS NOT NULL
         OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       ) THEN
      RAISE EXCEPTION 'a revoked telegram engagement endpoint is terminal'
        USING ERRCODE = '23514';
    END IF;

    -- A revoked endpoint may only stop owing Telegram a call (`delete` ->
    -- NULL), never start owing one again: re-arming `delete` would bring the
    -- bot's token back into the dispatcher's view (audit M-B of PR #1260).
    IF OLD.state = 'revoked'
       AND NEW.provider_action IS NOT NULL
       AND NEW.provider_action IS DISTINCT FROM OLD.provider_action THEN
      RAISE EXCEPTION 'a revoked telegram engagement endpoint cannot be re-armed'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.secret_id IS NOT NULL
       AND NEW.secret_id IS DISTINCT FROM OLD.secret_id THEN
      RAISE EXCEPTION 'a telegram engagement endpoint secret is never swapped; rotate instead'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  -- INSERT: the bot must be a live telegram bot account of THIS tenant. A
  -- composite foreign key already pins the tenant; this pins the provider and
  -- kind, so no other account kind can ever acquire a public callback here.
  SELECT EXISTS (
    SELECT 1
    FROM awcms_channel_accounts a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.id = NEW.account_id
      AND a.provider = 'telegram'
      AND a.account_kind = 'bot'
      AND a.deleted_at IS NULL
  ) INTO account_ok;

  IF NOT account_ok THEN
    RAISE EXCEPTION 'a telegram engagement endpoint needs a live telegram bot account'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state <> 'pending' THEN
    RAISE EXCEPTION 'a telegram engagement endpoint is created pending'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_telegram_engagement_endpoints_guard
  BEFORE INSERT OR UPDATE ON awcms_telegram_engagement_endpoints
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_engagement_endpoints_guard();

CREATE OR REPLACE FUNCTION awcms_telegram_engagement_contacts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a telegram engagement contact identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- The keyed hash changes exactly once: in the statement that ENDS the
  -- contact, where the application replaces it with a random value so the
  -- erased row can no longer be found from the person's Telegram id (and a
  -- returning person starts a fresh, unrelated contact).
  IF NEW.contact_hash IS DISTINCT FROM OLD.contact_hash
     AND NOT (OLD.state <> 'ended' AND NEW.state = 'ended') THEN
    RAISE EXCEPTION 'a telegram engagement contact hash changes only when it ends'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'ended' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'an ended telegram engagement contact is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_telegram_engagement_contacts_guard
  BEFORE UPDATE ON awcms_telegram_engagement_contacts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_engagement_contacts_guard();

CREATE OR REPLACE FUNCTION awcms_telegram_engagement_messages_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.consent_evidence_id IS DISTINCT FROM OLD.consent_evidence_id
     OR NEW.prompt_purpose IS DISTINCT FROM OLD.prompt_purpose
     OR NEW.prompt_notice_version IS DISTINCT FROM OLD.prompt_notice_version
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a telegram engagement message snapshot is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('sent', 'uncertain', 'failed', 'cancelled')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'a finalised telegram engagement message is terminal'
      USING ERRCODE = '23514';
  END IF;

  -- The text can only ever be removed, never (re)written after insert.
  IF NEW.text_ciphertext IS NOT NULL
     AND NEW.text_ciphertext IS DISTINCT FROM OLD.text_ciphertext THEN
    RAISE EXCEPTION 'a telegram engagement message text cannot be rewritten'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_telegram_engagement_messages_guard
  BEFORE UPDATE ON awcms_telegram_engagement_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_engagement_messages_guard();
