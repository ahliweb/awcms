-- `whatsapp_delivery` sender routing: the database guards now match the
-- application layer on the SHAPE of a sender and on which defaults are admissible
-- (Issue #1231 L6, a residual finding of the independent audit of Issue #1141).
-- Forward-only; `sql/322` and `sql/324` are applied and are NOT edited. This file
-- REPLACES the two guard functions of `sql/322` in place (`CREATE OR REPLACE`, the
-- triggers that call them are unchanged).
--
-- ## What was loose
--
--   * The message insert guard checked only that the sender is a live, connected
--     account of the message's tenant inside the message's business scope. A
--     `connected` account of ANY provider or kind (a Facebook page, a Mailketing
--     account, a WABA container) passed it, so a caller that stepped around the
--     application could queue a message that no WhatsApp adapter can ever send:
--     it would wait, then fail, on a lane that must not exist.
--   * The policy guard admitted any default that is not `revoked`, `disabled` or
--     `deleted`, so a `pending` or `degraded` account (and any provider or kind)
--     could be stored as a scope's default. The application refuses all of them:
--     `setSenderPolicy` needs a usable `dm` verdict, and the account port answers
--     usable only for a `connected` account of a WhatsApp sender shape.
--
-- ## What this changes
--
--   * SHAPE, both guards: the account must be a WhatsApp sender shape, exactly
--     the one `isWhatsappSenderShape` accepts (`channel_accounts`): a
--     `whatsapp_cloud` `waba_phone_number`, or a `starsender` `device`. A WABA
--     container, another provider or another kind is refused. (StarSender has no
--     dispatch adapter until Issue #1142: that is the application's decision at
--     enqueue and policy time, and the database deliberately does not hard-code
--     which adapters this build ships.)
--   * POLICY DEFAULT: must be `connected` (not merely "not revoked"). The check is
--     applied when a default is INSERTED or CHANGED, never when an unrelated
--     column of an existing policy is updated, so a policy whose default account
--     later degrades can still be re-pointed to NULL or to another sender, and
--     existing rows are untouched.
--
-- ## What this deliberately does NOT do
--
-- CAPABILITY (`dm`/`reply`/`broadcast` granted, with evidence and a current
-- matrix version) is not evaluated here. Which capability a message needs depends
-- on its purpose and on thread affinity, the evidence rules live in the
-- provider matrix (application code, versioned), and a trigger that duplicated
-- them would drift from it the first time the matrix changes. The application
-- evaluates capability at enqueue, at dispatch (per lane and per row) and when a
-- policy is set; the database guards keep the facts a trigger CAN decide from
-- this tenant's own rows: live, connected, WhatsApp shape, in scope.
--
-- Both functions run as the invoker (as in `sql/322`) and read only
-- `awcms_channel_accounts`, which the inserting roles already read.
CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_sender_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_provider text;
  v_kind text;
  v_scope_type text;
  v_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id
       OR NEW.sender_selection IS DISTINCT FROM OLD.sender_selection
       OR NEW.sender_policy_version IS DISTINCT FROM OLD.sender_policy_version
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
      RAISE EXCEPTION 'a WhatsApp message sender snapshot is immutable'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.sender_account_id IS NOT NULL THEN
    SELECT status, provider, account_kind, business_scope_type, business_scope_id
      INTO v_status, v_provider, v_kind,
           v_scope_type, v_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND OR v_status <> 'connected' THEN
      RAISE EXCEPTION 'a WhatsApp message needs a connected sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      (v_provider = 'whatsapp_cloud' AND v_kind = 'waba_phone_number')
      OR (v_provider = 'starsender' AND v_kind = 'device')
    ) THEN
      RAISE EXCEPTION 'a WhatsApp message sender account must be a WhatsApp number (whatsapp_cloud phone number or starsender device)'
        USING ERRCODE = '23514';
    END IF;

    IF v_scope_type IS NOT NULL
       AND (v_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR v_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only send within its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION awcms_whatsapp_sender_policies_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_provider text;
  v_kind text;
  v_scope_type text;
  v_scope_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
      RAISE EXCEPTION 'a WhatsApp sender policy tenant and business scope are immutable'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.config_version < OLD.config_version THEN
      RAISE EXCEPTION 'a WhatsApp sender policy version only moves forward'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Checked when a default is stored or changed, not on every update of the row.
  IF NEW.default_sender_account_id IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.default_sender_account_id IS DISTINCT FROM OLD.default_sender_account_id) THEN
    SELECT status, provider, account_kind, business_scope_type, business_scope_id
      INTO v_status, v_provider, v_kind,
           v_scope_type, v_scope_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.default_sender_account_id
      AND deleted_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'a WhatsApp sender policy default needs a live sender account of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF v_status <> 'connected' THEN
      RAISE EXCEPTION 'a WhatsApp sender policy default needs a connected sender account (not pending, degraded, revoked or disabled)'
        USING ERRCODE = '23514';
    END IF;

    IF NOT (
      (v_provider = 'whatsapp_cloud' AND v_kind = 'waba_phone_number')
      OR (v_provider = 'starsender' AND v_kind = 'device')
    ) THEN
      RAISE EXCEPTION 'a WhatsApp sender policy default must be a WhatsApp number (whatsapp_cloud phone number or starsender device)'
        USING ERRCODE = '23514';
    END IF;

    IF v_scope_type IS NOT NULL
       AND (v_scope_type IS DISTINCT FROM NEW.business_scope_type
            OR v_scope_id IS DISTINCT FROM NEW.business_scope_id) THEN
      RAISE EXCEPTION 'a scoped sender account may only be the default of its own business scope'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
