-- `telegram_engagement` -- customer Telegram conversations (Issue #1156,
-- ADR-0152; inbound envelope ADR-0150; account model ADR-0148 / #1140).
--
-- A SEPARATE context from `telegram_delivery` (ADR-0140, staff-only, one bot per
-- deployment). Nothing here references, reads or alters a `telegram_delivery`
-- table, and no table of that module references these (ADR-0152 TG1).
--
-- ## The five tables
--
--   awcms_telegram_engagement_endpoints  one verified webhook per customer bot.
--       A bot IS a `channel_accounts` row (provider `telegram`, kind `bot`); its
--       token is that account's `channel_secret`. This row holds the per-bot
--       webhook material: a reference to ONE channel secret (purpose
--       `webhook_signing_secret`) from which the callback path secret and the
--       `X-Telegram-Bot-Api-Secret-Token` value are DERIVED (two independent
--       HMACs, so knowing the URL never yields the header), and only the
--       SHA-256 of the callback path secret. Rotation creates a new row and
--       revokes the old one in the same transaction (hard cut, ADR-0152 O8).
--   awcms_telegram_engagement_contacts   a person who STARTED one bot. The key is
--       a keyed hash of (tenant, account, Telegram user id): the same person
--       under two bots, or two tenants, is two unrelated rows (ADR-0152 TG8).
--       The chat id exists only as an AES-256-GCM envelope (AAD = purpose +
--       tenant + row id) and is ERASED by the statement that ends the contact.
--   awcms_telegram_engagement_consents   append-only consent evidence per
--       purpose (`/start` = support only; marketing/transactional need the
--       explicit button; `/stop`, a block or a provider 403 withdraw at once).
--       No message text, ever.
--   awcms_telegram_engagement_inbound    the receipt ledger and replay key
--       (ADR-0150 section 2): UNIQUE (tenant, account, update_id). No body, no
--       sender id, no text: a payload hash, a closed kind and outcome.
--   awcms_telegram_engagement_messages   the module's OWN outbound queue
--       (ADR-0152 section 5, O1): a reply or an opted-in notice to a CONTACT
--       (never a chat id), with the consent evidence it relied on snapshotted,
--       leased and finalised per row. The text is an envelope, cleared at the
--       terminal state.
--
-- ## RLS / GRANT
--
-- Every table is ENABLE + FORCE ROW LEVEL SECURITY with the tenant isolation
-- policy (USING + WITH CHECK). The webhook route needs no SECURITY DEFINER
-- bootstrap: its callback token NAMES the tenant and endpoint it claims (the
-- `website_engagement` precedent, ADR-0155), the route opens THAT tenant's
-- context and proves the secret half there. A token naming the wrong tenant
-- finds no row.
--
-- awcms_worker gets exactly what the generic data_lifecycle purge needs on the
-- two purged tables (receipts and messages): SELECT (id, tenant_id, cursor) and
-- DELETE; and column-only SELECT (id, tenant_id, cursor) on the two retained
-- tables for the lifecycle dry-run count. Nothing else: the dispatcher runs as awcms_app (see the module
-- README, "Why the dispatcher runs as awcms_app").
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- ---------------------------------------------------------------------------
-- Endpoints
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_engagement_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  -- NULL once revoked: the secret row is hard-deleted with the revocation.
  secret_id uuid,
  -- `sha256:<hex>` of the callback path secret. UNIQUE across tenants: 256
  -- random bits make a collision a non-event, and the index makes a lookup
  -- cheap. Never the secret itself.
  callback_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  -- What the connector job still owes Telegram for this row: `set` (call
  -- getMe + setWebhook), `delete` (call deleteWebhook after a revocation),
  -- NULL (nothing). Provider I/O never runs in a request (ADR-0148 I10).
  provider_action text,
  connector_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  connector_lease_until timestamptz,
  last_error_code text,
  -- The bot id `getMe` returned (must equal the account's external id) and its
  -- public @username, for display. A bot username is not personal data.
  verified_bot_id text,
  bot_username text,
  verified_at timestamptz,
  activated_at timestamptz,
  last_update_at timestamptz,
  -- Outbound budget (ADR-0152 section 5, O10): the tenant's per-bot daily
  -- ceiling, never above the deployment cap the dispatcher applies.
  daily_send_ceiling integer NOT NULL DEFAULT 500,
  -- Per-bot circuit breaker.
  consecutive_failures integer NOT NULL DEFAULT 0,
  breaker_open_until timestamptz,
  created_by uuid,
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_engagement_endpoints_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_endpoints_callback_key UNIQUE (callback_hash),
  CONSTRAINT awcms_telegram_engagement_endpoints_callback_check
    CHECK (callback_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_telegram_engagement_endpoints_state_check
    CHECK (state IN ('pending', 'active', 'failed', 'revoked')),
  CONSTRAINT awcms_telegram_engagement_endpoints_action_check
    CHECK (provider_action IS NULL OR provider_action IN ('set', 'delete')),
  CONSTRAINT awcms_telegram_engagement_endpoints_attempts_check
    CHECK (connector_attempts >= 0 AND consecutive_failures >= 0),
  CONSTRAINT awcms_telegram_engagement_endpoints_error_check
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT awcms_telegram_engagement_endpoints_bot_id_check
    CHECK (verified_bot_id IS NULL OR verified_bot_id ~ '^[0-9]{1,20}$'),
  CONSTRAINT awcms_telegram_engagement_endpoints_username_check
    CHECK (bot_username IS NULL OR bot_username ~ '^[A-Za-z0-9_]{1,64}$'),
  CONSTRAINT awcms_telegram_engagement_endpoints_ceiling_check
    CHECK (daily_send_ceiling BETWEEN 1 AND 100000),
  CONSTRAINT awcms_telegram_engagement_endpoints_revoke_reason_check
    CHECK (revoke_reason IS NULL OR revoke_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  -- A live row holds its secret; a revoked one holds none and says when.
  CONSTRAINT awcms_telegram_engagement_endpoints_revoked_shape CHECK (
    (state = 'revoked') = (revoked_at IS NOT NULL)
    AND (state = 'revoked' OR secret_id IS NOT NULL)
  ),
  CONSTRAINT awcms_telegram_engagement_endpoints_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_endpoints_secret_fk
    FOREIGN KEY (tenant_id, secret_id)
    REFERENCES awcms_channel_secrets (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_endpoints_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_endpoints_revoked_by_fk
    FOREIGN KEY (tenant_id, revoked_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- One live endpoint per bot: a bot has ONE webhook at Telegram.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_live_account_key
  ON awcms_telegram_engagement_endpoints (tenant_id, account_id)
  WHERE state <> 'revoked';

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_account_idx
  ON awcms_telegram_engagement_endpoints (tenant_id, account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_connector_idx
  ON awcms_telegram_engagement_endpoints (tenant_id, next_attempt_at)
  WHERE provider_action IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_secret_idx
  ON awcms_telegram_engagement_endpoints (tenant_id, secret_id)
  WHERE secret_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_created_by_idx
  ON awcms_telegram_engagement_endpoints (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_endpoints_revoked_by_idx
  ON awcms_telegram_engagement_endpoints (tenant_id, revoked_by)
  WHERE revoked_by IS NOT NULL;

ALTER TABLE awcms_telegram_engagement_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_engagement_endpoints FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_engagement_endpoints_tenant_isolation
  ON awcms_telegram_engagement_endpoints
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_telegram_engagement_endpoints FROM awcms_app;
REVOKE ALL ON awcms_telegram_engagement_endpoints FROM awcms_worker;
-- Column-only, for the data_lifecycle dry-run snapshot count: no hash, no
-- secret reference.
GRANT SELECT (id, tenant_id, created_at) ON awcms_telegram_engagement_endpoints TO awcms_worker;

COMMENT ON TABLE awcms_telegram_engagement_endpoints IS
  'Issue #1156 / ADR-0152 section 4 -- one verified webhook per customer Telegram bot (a channel_accounts row). Holds a REFERENCE to one channel secret from which the callback path secret and the secret-token header are derived, and only the SHA-256 of the callback path secret. Never returned, logged or evented. Rotation = new row + revoked old row (hard cut).';

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_engagement_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  -- `keyId:hex` keyed HMAC of the Telegram user id, domain-separated by tenant
  -- AND account (ADR-0152 TG8): it cannot correlate one person across bots.
  contact_hash text NOT NULL,
  -- v2 envelope of the private chat id. NULL once the contact is ended.
  chat_ciphertext text,
  -- A masked, non-reversible label for operators (`tg-…1234`). NULL once ended.
  masked_label text,
  state text NOT NULL DEFAULT 'started',
  -- Provenance of the first `/start` (a deep-link parameter: which page or
  -- campaign sent the person). NEVER consent (ADR-0152 section 6).
  start_param text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_inbound_at timestamptz,
  stopped_at timestamptz,
  blocked_at timestamptz,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_engagement_contacts_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_contacts_identity_key
    UNIQUE (tenant_id, account_id, contact_hash),
  CONSTRAINT awcms_telegram_engagement_contacts_hash_check
    CHECK (contact_hash ~ '^[a-z0-9]{1,8}:[0-9a-f]{64}$'),
  CONSTRAINT awcms_telegram_engagement_contacts_envelope_check CHECK (
    chat_ciphertext IS NULL OR (
      chat_ciphertext ~ '^v2:[a-z0-9]{1,8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$'
      AND char_length(chat_ciphertext) <= 512
    )
  ),
  CONSTRAINT awcms_telegram_engagement_contacts_label_check
    CHECK (masked_label IS NULL OR char_length(masked_label) BETWEEN 1 AND 32),
  CONSTRAINT awcms_telegram_engagement_contacts_state_check
    CHECK (state IN ('started', 'stopped', 'blocked', 'ended')),
  CONSTRAINT awcms_telegram_engagement_contacts_start_param_check
    CHECK (start_param IS NULL OR start_param ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Ending a contact erases what identifies the person, in the same statement.
  CONSTRAINT awcms_telegram_engagement_contacts_ended_shape CHECK (
    (state = 'ended') = (ended_at IS NOT NULL)
    AND (state <> 'ended' OR (chat_ciphertext IS NULL AND masked_label IS NULL))
    AND (state = 'ended' OR chat_ciphertext IS NOT NULL)
  ),
  CONSTRAINT awcms_telegram_engagement_contacts_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_contacts_list_idx
  ON awcms_telegram_engagement_contacts (tenant_id, account_id, started_at DESC, id DESC);

ALTER TABLE awcms_telegram_engagement_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_engagement_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_engagement_contacts_tenant_isolation
  ON awcms_telegram_engagement_contacts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_telegram_engagement_contacts FROM awcms_app;
REVOKE ALL ON awcms_telegram_engagement_contacts FROM awcms_worker;
-- The data_lifecycle dry-run snapshot counts rows by (tenant, cursor) for the
-- retained descriptor. Column-only: the worker can read no hash, ciphertext or
-- label, and it holds no write of any kind.
GRANT SELECT (id, tenant_id, started_at) ON awcms_telegram_engagement_contacts TO awcms_worker;

COMMENT ON TABLE awcms_telegram_engagement_contacts IS
  'Issue #1156 / ADR-0152 section 6 -- a person who started ONE customer bot. Account-scoped keyed hash (no cross-bot or cross-tenant correlation), chat id only as an envelope erased when the contact ends, a masked label. Not a customer master: the CRM person lives downstream.';

-- ---------------------------------------------------------------------------
-- Consent evidence (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_engagement_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  contact_id uuid NOT NULL,
  purpose text NOT NULL,
  action text NOT NULL,
  -- The notice text VERSION shown for an explicit opt-in. Required for
  -- `consent_button`; never the text.
  notice_version text,
  -- The Telegram update that carried the fact (per-bot sequence), when one did.
  update_id bigint,
  method text NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- THE order of the evidence (audit M-1 of PR #1260). `recorded_at` is the
  -- START of the writing transaction, so a /stop whose transaction began before
  -- a concurrent opt-in committed would sort BEFORE it and lose. Every writer
  -- holds the contact row lock (`FOR UPDATE`) before inserting, so identity
  -- values are drawn in lock order, which is commit order for one contact: the
  -- later fact always has the larger value. `recorded_at` is kept for retention.
  evidence_seq bigint GENERATED ALWAYS AS IDENTITY,
  recorded_by uuid,
  CONSTRAINT awcms_telegram_engagement_consents_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_consents_purpose_check
    CHECK (purpose IN ('support', 'transactional', 'marketing')),
  CONSTRAINT awcms_telegram_engagement_consents_action_check
    CHECK (action IN ('opt_in', 'opt_out')),
  CONSTRAINT awcms_telegram_engagement_consents_method_check CHECK (
    method IN ('start_command', 'stop_command', 'consent_button',
               'withdraw_button', 'bot_blocked', 'provider_forbidden',
               'operator_withdrawal')
  ),
  CONSTRAINT awcms_telegram_engagement_consents_notice_check
    CHECK (notice_version IS NULL OR notice_version ~ '^[A-Za-z0-9._-]{1,40}$'),
  -- `/start` grants SUPPORT only (ADR-0152 TG7); marketing and transactional
  -- opt-ins exist only through the explicit button, with a notice version.
  CONSTRAINT awcms_telegram_engagement_consents_start_is_support_only CHECK (
    method <> 'start_command' OR (purpose = 'support' AND action = 'opt_in')
  ),
  CONSTRAINT awcms_telegram_engagement_consents_explicit_opt_in CHECK (
    action <> 'opt_in' OR purpose = 'support'
    OR (method = 'consent_button' AND notice_version IS NOT NULL)
  ),
  CONSTRAINT awcms_telegram_engagement_consents_update_check
    CHECK (update_id IS NULL OR update_id >= 0),
  CONSTRAINT awcms_telegram_engagement_consents_contact_fk
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES awcms_telegram_engagement_contacts (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_consents_recorded_by_fk
    FOREIGN KEY (tenant_id, recorded_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_consents_contact_idx
  ON awcms_telegram_engagement_consents (tenant_id, contact_id, purpose, evidence_seq DESC);

-- (tenant, cursor) for the data_lifecycle descriptor.
CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_consents_recorded_at_idx
  ON awcms_telegram_engagement_consents (tenant_id, recorded_at);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_consents_recorded_by_idx
  ON awcms_telegram_engagement_consents (tenant_id, recorded_by)
  WHERE recorded_by IS NOT NULL;

ALTER TABLE awcms_telegram_engagement_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_engagement_consents FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_engagement_consents_tenant_isolation
  ON awcms_telegram_engagement_consents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_telegram_engagement_consents FROM awcms_app;
REVOKE ALL ON awcms_telegram_engagement_consents FROM awcms_worker;
-- Column-only, for the data_lifecycle dry-run snapshot count (see contacts).
GRANT SELECT (id, tenant_id, recorded_at) ON awcms_telegram_engagement_consents TO awcms_worker;

COMMENT ON TABLE awcms_telegram_engagement_consents IS
  'Issue #1156 / ADR-0152 section 6 -- append-only consent evidence per purpose. /start is support only; marketing and transactional need the explicit button with a notice version; /stop, a block and a provider 403 withdraw at once. Carries no message text. A correction is a new row.';

-- ---------------------------------------------------------------------------
-- Inbound receipts (ADR-0150 section 2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_engagement_inbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  endpoint_id uuid NOT NULL,
  -- Telegram's per-BOT sequence; never compared across bots.
  update_id bigint NOT NULL,
  update_kind text NOT NULL,
  outcome text NOT NULL,
  contact_id uuid,
  privacy_class text NOT NULL,
  payload_hash text NOT NULL,
  correlation_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_engagement_inbound_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_inbound_replay_key
    UNIQUE (tenant_id, account_id, update_id),
  CONSTRAINT awcms_telegram_engagement_inbound_update_check CHECK (update_id >= 0),
  CONSTRAINT awcms_telegram_engagement_inbound_kind_check CHECK (
    update_kind IN ('message', 'command', 'consent_button', 'membership', 'other')
  ),
  CONSTRAINT awcms_telegram_engagement_inbound_outcome_check CHECK (
    outcome IN ('published', 'recorded', 'ignored', 'rejected')
  ),
  CONSTRAINT awcms_telegram_engagement_inbound_privacy_check CHECK (
    privacy_class IN ('operational', 'consent', 'conversation_meta', 'customer_content')
  ),
  CONSTRAINT awcms_telegram_engagement_inbound_payload_hash_check
    CHECK (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT awcms_telegram_engagement_inbound_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_inbound_endpoint_fk
    FOREIGN KEY (tenant_id, endpoint_id)
    REFERENCES awcms_telegram_engagement_endpoints (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_inbound_contact_fk
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES awcms_telegram_engagement_contacts (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_inbound_received_at_idx
  ON awcms_telegram_engagement_inbound (tenant_id, received_at);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_inbound_endpoint_idx
  ON awcms_telegram_engagement_inbound (tenant_id, endpoint_id);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_inbound_contact_idx
  ON awcms_telegram_engagement_inbound (tenant_id, contact_id)
  WHERE contact_id IS NOT NULL;

ALTER TABLE awcms_telegram_engagement_inbound ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_engagement_inbound FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_engagement_inbound_tenant_isolation
  ON awcms_telegram_engagement_inbound
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_telegram_engagement_inbound FROM awcms_app;
REVOKE ALL ON awcms_telegram_engagement_inbound FROM awcms_worker;
GRANT SELECT (id, tenant_id, received_at) ON awcms_telegram_engagement_inbound TO awcms_worker;
GRANT DELETE ON awcms_telegram_engagement_inbound TO awcms_worker;

COMMENT ON TABLE awcms_telegram_engagement_inbound IS
  'Issue #1156 / ADR-0150 section 2 -- the inbound receipt ledger and replay key, UNIQUE (tenant, account, update_id). No body, no sender id, no text. Removed only by the data_lifecycle retention purge.';

-- ---------------------------------------------------------------------------
-- Outbound queue (ADR-0152 section 5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_engagement_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  account_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  purpose text NOT NULL,
  kind text NOT NULL,
  -- The consent evidence row the enqueue relied on (support: the latest
  -- start; marketing/transactional: the explicit opt-in). Re-checked at
  -- dispatch: a later withdrawal wins over everything queued.
  consent_evidence_id uuid NOT NULL,
  -- `consent_prompt` only: which purpose and notice version the buttons ask for.
  prompt_purpose text,
  prompt_notice_version text,
  -- v2 envelope of the text (customer_content). Cleared at the terminal state.
  text_ciphertext text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  -- Telegram's message id in the chat (for the consent-button check).
  provider_message_id bigint,
  failure_code text,
  expires_at timestamptz NOT NULL,
  created_by uuid,
  sent_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_engagement_messages_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_messages_purpose_check
    CHECK (purpose IN ('support', 'transactional', 'marketing')),
  CONSTRAINT awcms_telegram_engagement_messages_kind_check
    CHECK (kind IN ('text', 'consent_prompt')),
  CONSTRAINT awcms_telegram_engagement_messages_prompt_check CHECK (
    (kind = 'consent_prompt') = (prompt_purpose IS NOT NULL AND prompt_notice_version IS NOT NULL)
    AND (prompt_purpose IS NULL OR prompt_purpose IN ('transactional', 'marketing'))
    AND (prompt_notice_version IS NULL OR prompt_notice_version ~ '^[A-Za-z0-9._-]{1,40}$')
  ),
  CONSTRAINT awcms_telegram_engagement_messages_status_check CHECK (
    status IN ('queued', 'sending', 'sent', 'uncertain', 'failed', 'cancelled')
  ),
  CONSTRAINT awcms_telegram_engagement_messages_envelope_check CHECK (
    text_ciphertext IS NULL OR (
      text_ciphertext ~ '^v2:[a-z0-9]{1,8}:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$'
      AND char_length(text_ciphertext) <= 16384
    )
  ),
  -- Content does not outlive the row's usefulness (ADR-0152 TG11, I3).
  CONSTRAINT awcms_telegram_engagement_messages_terminal_clears_text CHECK (
    status IN ('queued', 'sending') OR text_ciphertext IS NULL
  ),
  CONSTRAINT awcms_telegram_engagement_messages_attempts_check CHECK (attempts >= 0),
  CONSTRAINT awcms_telegram_engagement_messages_failure_check
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT awcms_telegram_engagement_messages_account_fk
    FOREIGN KEY (tenant_id, account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_messages_contact_fk
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES awcms_telegram_engagement_contacts (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_messages_consent_fk
    FOREIGN KEY (tenant_id, consent_evidence_id)
    REFERENCES awcms_telegram_engagement_consents (tenant_id, id),
  CONSTRAINT awcms_telegram_engagement_messages_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_due_idx
  ON awcms_telegram_engagement_messages (tenant_id, account_id, next_attempt_at)
  WHERE status IN ('queued', 'sending');

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_created_at_idx
  ON awcms_telegram_engagement_messages (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_contact_idx
  ON awcms_telegram_engagement_messages (tenant_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_account_sent_idx
  ON awcms_telegram_engagement_messages (tenant_id, account_id, sent_at)
  WHERE sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_consent_idx
  ON awcms_telegram_engagement_messages (tenant_id, consent_evidence_id);

CREATE INDEX IF NOT EXISTS awcms_telegram_engagement_messages_created_by_idx
  ON awcms_telegram_engagement_messages (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE awcms_telegram_engagement_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_engagement_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_engagement_messages_tenant_isolation
  ON awcms_telegram_engagement_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_telegram_engagement_messages FROM awcms_app;
REVOKE ALL ON awcms_telegram_engagement_messages FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at) ON awcms_telegram_engagement_messages TO awcms_worker;
GRANT DELETE ON awcms_telegram_engagement_messages TO awcms_worker;

COMMENT ON TABLE awcms_telegram_engagement_messages IS
  'Issue #1156 / ADR-0152 section 5 -- the telegram_engagement outbound queue (a second Telegram queue, separate from telegram_delivery, ADR-0152 O1). Addressed to a CONTACT, never a chat id; consent evidence snapshotted and re-checked at dispatch; text is an envelope cleared at the terminal state. Removed only by the data_lifecycle retention purge.';
