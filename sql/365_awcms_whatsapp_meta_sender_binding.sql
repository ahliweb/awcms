-- `whatsapp_delivery` Meta Cloud API multi-WABA, multi-number sender binding
-- (Issue #1143, ADR-0148 section 4 and conditions of the issue's owner comment).
-- Forward-only: sql/178, sql/322, sql/324, sql/328, sql/329 and sql/354 are
-- applied and are NOT edited; the sender guard is replaced with CREATE OR
-- REPLACE below, exactly as sql/329 replaced the one of sql/322.
--
-- ## What this file adds
--
--   1. The VERIFIED SENDER IDENTITY is snapshotted on the queue row at INSERT:
--      `sender_external_id` (the Meta `phone_number_id`, or the StarSender device
--      id) and `sender_container_external_id` (the WABA id of a Meta number).
--      The guard fills them from the account record when the caller leaves them
--      NULL, refuses a value that does not match the record, refuses a Meta
--      number whose parent is not a live `waba` container of the same provider
--      (an invalid WABA binding), and makes both immutable afterwards for every
--      role. The dispatcher compares the live record with the snapshot, so a
--      row can never be sent from another phone number id or WABA than the one
--      it was queued for.
--   2. The PROVIDER-REPORTED delivery status of a sent row (`provider_status`,
--      `provider_status_rank`, `provider_status_at`, `provider_failure_code`),
--      written only by a SIGNED Meta webhook resolved to the row's own sender.
--      `status` (the queue state) is not touched: "accepted" by the provider is
--      `sent`; `delivered` and `read` are separate facts and only ever move
--      forward (the rank).
--   3. `awcms_whatsapp_meta_templates`: which Meta template (name, language,
--      category) is APPROVED on which WABA. Meta approves templates per WABA,
--      so a template approved on one number's WABA authorises nothing on
--      another. Absent row = not approved (fail closed).
--   4. `awcms_whatsapp_service_windows`: the 24-hour customer-service window
--      per (sender, recipient hash), opened only by a verified inbound message
--      to THAT sender. No message content is stored.
--   5. `awcms_whatsapp_meta_sender_signals`: per WABA, the latest restriction
--      (ban, restriction, deletion, offboarding, app uninstall) and the
--      messaging-limit tier Meta reported. A restricted WABA's numbers are
--      refused at enqueue and held at dispatch; nothing is rerouted.
--   6. `awcms_whatsapp_webhook_receipts`: the SHA-256 of every verified
--      webhook body per subscription, so a replayed (or retried) delivery is a
--      no-op. Purged after 8 days (Meta retries for up to 7).
--
-- ## Rows queued before this file
--
-- They keep NULL snapshots (no DML here: the table is FORCE RLS and keyed by
-- tenant context, and the guard forbids changing a snapshot afterwards). The
-- dispatcher treats a NULL snapshot as "enqueued before the binding existed"
-- and still requires the CURRENT record to have a valid WABA binding, so an
-- old row of an unbound number fails closed.

ALTER TABLE awcms_whatsapp_messages
  ADD COLUMN IF NOT EXISTS sender_external_id text,
  ADD COLUMN IF NOT EXISTS sender_container_external_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_status_rank smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_failure_code text;

ALTER TABLE awcms_whatsapp_messages
  ADD CONSTRAINT awcms_whatsapp_messages_sender_external_id_check
    CHECK (
      sender_external_id IS NULL
      OR (char_length(sender_external_id) BETWEEN 1 AND 256
          AND sender_external_id = btrim(sender_external_id))
    ),
  ADD CONSTRAINT awcms_whatsapp_messages_sender_container_check
    CHECK (
      sender_container_external_id IS NULL
      OR (char_length(sender_container_external_id) BETWEEN 1 AND 256
          AND sender_container_external_id = btrim(sender_container_external_id))
    ),
  -- The deployment sender carries no tenant identity at all.
  ADD CONSTRAINT awcms_whatsapp_messages_deployment_unbound_check
    CHECK (
      sender_account_id IS NOT NULL
      OR (sender_external_id IS NULL AND sender_container_external_id IS NULL)
    ),
  ADD CONSTRAINT awcms_whatsapp_messages_provider_status_check
    CHECK (
      (provider_status IS NULL AND provider_status_rank = 0)
      OR (provider_status = 'sent' AND provider_status_rank = 1)
      OR (provider_status = 'delivered' AND provider_status_rank = 2)
      OR (provider_status = 'read' AND provider_status_rank = 3)
      OR (provider_status = 'failed' AND provider_status_rank = 9)
    ),
  ADD CONSTRAINT awcms_whatsapp_messages_provider_failure_code_check
    CHECK (
      provider_failure_code IS NULL
      OR provider_failure_code ~ '^meta_[0-9]{1,9}$'
    );

-- Reconciliation looks a status up by (tenant, the sender the webhook resolved
-- to, the provider message id), never by the message id alone.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_provider_message_idx
  ON awcms_whatsapp_messages (tenant_id, sender_account_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL AND sender_account_id IS NOT NULL;

COMMENT ON COLUMN awcms_whatsapp_messages.sender_external_id IS
  'Issue #1143 - the verified sender identity at enqueue: the Meta phone_number_id or the StarSender device id of sender_account_id, filled and checked by the sender guard, IMMUTABLE. The dispatcher refuses to send when the live record differs.';
COMMENT ON COLUMN awcms_whatsapp_messages.sender_container_external_id IS
  'Issue #1143 - the WABA id of a Meta sender at enqueue (the parent waba container), filled and checked by the sender guard, IMMUTABLE. NULL for StarSender and the deployment sender.';
COMMENT ON COLUMN awcms_whatsapp_messages.provider_status IS
  'Issue #1143 - what the provider REPORTED through a signed webhook resolved to this row''s own sender and provider message id: sent, delivered, read or failed. Forward-only by rank; separate from the queue status.';

CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_sender_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_provider text;
  v_kind text;
  v_external_id text;
  v_parent_id uuid;
  v_scope_type text;
  v_scope_id uuid;
  v_container_external_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.sender_account_id IS DISTINCT FROM OLD.sender_account_id
       OR NEW.sender_selection IS DISTINCT FROM OLD.sender_selection
       OR NEW.sender_policy_version IS DISTINCT FROM OLD.sender_policy_version
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id
       OR NEW.sender_external_id IS DISTINCT FROM OLD.sender_external_id
       OR NEW.sender_container_external_id
            IS DISTINCT FROM OLD.sender_container_external_id THEN
      RAISE EXCEPTION 'a WhatsApp message sender snapshot is immutable'
        USING ERRCODE = '23514';
    END IF;

    -- The provider-reported status only moves forward.
    IF NEW.provider_status_rank < OLD.provider_status_rank THEN
      RAISE EXCEPTION 'a WhatsApp provider status only moves forward'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.sender_account_id IS NULL THEN
    IF NEW.sender_external_id IS NOT NULL
       OR NEW.sender_container_external_id IS NOT NULL THEN
      RAISE EXCEPTION 'the deployment sender carries no sender identity'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  SELECT status, provider, account_kind, external_id, parent_account_id,
         business_scope_type, business_scope_id
    INTO v_status, v_provider, v_kind, v_external_id, v_parent_id,
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

  IF NEW.sender_external_id IS NULL THEN
    NEW.sender_external_id := v_external_id;
  ELSIF NEW.sender_external_id IS DISTINCT FROM v_external_id THEN
    RAISE EXCEPTION 'a WhatsApp message sender identity must be the sender account''s own'
      USING ERRCODE = '23514';
  END IF;

  IF v_provider = 'whatsapp_cloud' THEN
    -- Issue #1143: a Meta number sends only as part of its WABA. The parent
    -- must be a live `waba` container of the same provider (it lends the
    -- binding, not necessarily the credential).
    SELECT external_id
      INTO v_container_external_id
    FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = v_parent_id
      AND provider = 'whatsapp_cloud' AND account_kind = 'waba'
      AND deleted_at IS NULL;

    IF v_parent_id IS NULL OR NOT FOUND THEN
      RAISE EXCEPTION 'a Meta WhatsApp number needs a live WABA container of its own tenant'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.sender_container_external_id IS NULL THEN
      NEW.sender_container_external_id := v_container_external_id;
    ELSIF NEW.sender_container_external_id
            IS DISTINCT FROM v_container_external_id THEN
      RAISE EXCEPTION 'a WhatsApp message WABA binding must be the sender account''s own'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.sender_container_external_id IS NOT NULL THEN
    RAISE EXCEPTION 'only a Meta WhatsApp number has a WABA binding'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Approved Meta templates, per WABA.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_meta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The `waba` container account the template is registered on.
  container_account_id uuid NOT NULL,
  template_name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  -- Meta's own template status event, verbatim from the closed list Meta
  -- documents for `message_template_status_update`. Only APPROVED and
  -- REINSTATED make the template sendable (application rule, fail closed).
  provider_status text NOT NULL,
  -- Required when an OPERATOR records a template as approved: where the
  -- approval can be checked (the WhatsApp Manager reference). A webhook write
  -- is evidence by itself (it is signed).
  evidence_ref text,
  source text NOT NULL,
  -- Ordering key: Meta's `entry.time` for a webhook, the statement time for an
  -- operator write. A change older than the stored one is ignored; on a tie the
  -- NOT-sendable status wins.
  last_event_at timestamptz NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_meta_templates_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_whatsapp_meta_templates_identity_key
    UNIQUE (tenant_id, container_account_id, template_name, language),
  CONSTRAINT awcms_whatsapp_meta_templates_name_check
    CHECK (
      template_name ~ '^[a-z0-9_]+$'
      AND char_length(template_name) BETWEEN 1 AND 512
    ),
  CONSTRAINT awcms_whatsapp_meta_templates_language_check
    CHECK (language ~ '^[A-Za-z]{2,3}([_-][A-Za-z0-9]{2,8}){0,2}$'),
  CONSTRAINT awcms_whatsapp_meta_templates_category_check
    CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  CONSTRAINT awcms_whatsapp_meta_templates_status_check
    CHECK (provider_status IN (
      'APPROVED', 'ARCHIVED', 'UNARCHIVED', 'DELETED', 'DISABLED', 'FLAGGED',
      'IN_APPEAL', 'LIMIT_EXCEEDED', 'LOCKED', 'PAUSED', 'PENDING',
      'REINSTATED', 'PENDING_DELETION', 'REJECTED'
    )),
  CONSTRAINT awcms_whatsapp_meta_templates_source_check
    CHECK (source IN ('operator', 'webhook')),
  CONSTRAINT awcms_whatsapp_meta_templates_evidence_check
    CHECK (
      (evidence_ref IS NULL OR char_length(evidence_ref) BETWEEN 1 AND 200)
      AND (
        source <> 'operator'
        OR provider_status NOT IN ('APPROVED', 'REINSTATED')
        OR evidence_ref IS NOT NULL
      )
    ),
  CONSTRAINT awcms_whatsapp_meta_templates_container_fk
    FOREIGN KEY (tenant_id, container_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_whatsapp_meta_templates_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_meta_templates_updated_by_idx
  ON awcms_whatsapp_meta_templates (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

COMMENT ON TABLE awcms_whatsapp_meta_templates IS
  'Issue #1143 - Meta template approval per WABA (name, language, category, Meta''s status). Absent row = not approved. Written by an operator (with evidence) or by a signed Meta webhook of a number of that WABA.';

ALTER TABLE awcms_whatsapp_meta_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_meta_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_meta_templates_tenant_isolation
  ON awcms_whatsapp_meta_templates
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 24-hour customer-service windows, per (sender, recipient hash).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_service_windows (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  sender_account_id uuid NOT NULL,
  -- The keyed recipient hash (`k1:<hex>`), never the number.
  recipient_hash text NOT NULL,
  last_inbound_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sender_account_id, recipient_hash),
  CONSTRAINT awcms_whatsapp_service_windows_hash_check
    CHECK (char_length(recipient_hash) BETWEEN 4 AND 200),
  CONSTRAINT awcms_whatsapp_service_windows_sender_fk
    FOREIGN KEY (tenant_id, sender_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_service_windows_purge_idx
  ON awcms_whatsapp_service_windows (tenant_id, last_inbound_at);

COMMENT ON TABLE awcms_whatsapp_service_windows IS
  'Issue #1143 - the latest verified inbound time per (Meta sender, recipient hash): the 24-hour customer-service window. No content, no number. Purged by whatsapp:queue:purge once the window is long closed.';

ALTER TABLE awcms_whatsapp_service_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_service_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_service_windows_tenant_isolation
  ON awcms_whatsapp_service_windows
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Per-WABA signals: restriction and messaging-limit tier.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_meta_sender_signals (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  container_account_id uuid NOT NULL,
  -- NULL = not restricted.
  restriction_reason text,
  restricted_at timestamptz,
  -- Meta's `entry.time` of the event that last changed the restriction.
  restriction_event_at timestamptz,
  messaging_limit_tier text,
  limit_event_at timestamptz,
  cleared_by uuid,
  cleared_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, container_account_id),
  CONSTRAINT awcms_whatsapp_meta_sender_signals_reason_check
    CHECK (restriction_reason IS NULL OR restriction_reason IN (
      'ACCOUNT_DELETED', 'ACCOUNT_RESTRICTION', 'DISABLED', 'OFFBOARDED',
      'APP_UNINSTALLED'
    )),
  CONSTRAINT awcms_whatsapp_meta_sender_signals_restricted_pair_check
    CHECK ((restriction_reason IS NULL) = (restricted_at IS NULL)),
  CONSTRAINT awcms_whatsapp_meta_sender_signals_tier_check
    CHECK (messaging_limit_tier IS NULL OR messaging_limit_tier IN (
      'TIER_50', 'TIER_250', 'TIER_1K', 'TIER_2K', 'TIER_10K', 'TIER_100K',
      'TIER_NOT_SET', 'TIER_UNLIMITED'
    )),
  CONSTRAINT awcms_whatsapp_meta_sender_signals_container_fk
    FOREIGN KEY (tenant_id, container_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_whatsapp_meta_sender_signals_cleared_by_fk
    FOREIGN KEY (tenant_id, cleared_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_meta_sender_signals_cleared_by_idx
  ON awcms_whatsapp_meta_sender_signals (tenant_id, cleared_by)
  WHERE cleared_by IS NOT NULL;

COMMENT ON TABLE awcms_whatsapp_meta_sender_signals IS
  'Issue #1143 - the latest restriction and messaging-limit tier Meta reported for a WABA, through a signed webhook of one of its numbers. A restricted WABA''s numbers are refused at enqueue and held at dispatch; nothing is rerouted. Fixed codes only, never provider text.';

ALTER TABLE awcms_whatsapp_meta_sender_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_meta_sender_signals FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_meta_sender_signals_tenant_isolation
  ON awcms_whatsapp_meta_sender_signals
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Verified webhook receipts (replay / retry suppression).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  subscription_id uuid NOT NULL,
  payload_sha256 text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_webhook_receipts_payload_key
    UNIQUE (tenant_id, subscription_id, payload_sha256),
  CONSTRAINT awcms_whatsapp_webhook_receipts_hash_check
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_whatsapp_webhook_receipts_subscription_fk
    FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES awcms_channel_webhook_subscriptions (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_webhook_receipts_received_idx
  ON awcms_whatsapp_webhook_receipts (tenant_id, received_at);

COMMENT ON TABLE awcms_whatsapp_webhook_receipts IS
  'Issue #1143 - SHA-256 of each VERIFIED Meta webhook body per subscription, so a replay or a provider retry changes nothing. Body not stored. Purged after 8 days by whatsapp:queue:purge.';

ALTER TABLE awcms_whatsapp_webhook_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_webhook_receipts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_webhook_receipts_tenant_isolation
  ON awcms_whatsapp_webhook_receipts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Worker grants. `awcms_app` is covered by sql/019's default privileges.
--
-- `whatsapp:dispatch` READS template approvals, windows and WABA signals; it
-- writes none of them (a worker that could would decide what Meta approved or
-- whether a WABA is banned). `whatsapp:queue:purge` deletes closed windows and
-- old receipts. Nothing here touches `awcms_channel_secrets`: the webhook's
-- signing secret is decrypted by the APPLICATION role in the request, and the
-- worker policy of sql/328 (which excludes `webhook_signing_secret`) is
-- unchanged.
-- ---------------------------------------------------------------------------
GRANT SELECT ON awcms_whatsapp_meta_templates TO awcms_worker;
GRANT SELECT ON awcms_whatsapp_meta_sender_signals TO awcms_worker;
GRANT SELECT, DELETE ON awcms_whatsapp_service_windows TO awcms_worker;
GRANT SELECT, DELETE ON awcms_whatsapp_webhook_receipts TO awcms_worker;
