-- telegram_engagement -- the SEPARATE database role of the customer bot
-- dispatcher (Issue #1156, ADR-0152 section 10; audit H-2 of PR #1260; the
-- ADR-0157 section 6 pattern, also used by `awcms_social_dispatch`).
-- Forward-only.
--
-- ## Why a separate role
--
-- `telegram-engagement:dispatch` decrypts a tenant's customer bot token and
-- webhook seed. The first revision ran it as `awcms_app` with
-- `CHANNEL_SECRETS_ENCRYPTION_KEYS`: a compromised job could then read and
-- decrypt EVERY channel secret of every tenant (WhatsApp, Mailketing, social,
-- staff-adjacent), because `awcms_app` sees the whole of `awcms_channel_secrets`
-- under the tenant setting the caller chooses. `awcms_worker` is not the answer
-- either: `sql/328` deliberately hides bot tokens from it, and widening that
-- policy would hand Telegram tokens to `whatsapp:dispatch`.
--
-- So this role, and nothing else, may read a customer bot's credentials:
--
--   * `awcms_worker`, `sql/328` and every WhatsApp/social role are NOT touched.
--   * `awcms_telegram_engagement_dispatch` holds NO table-level privilege, only
--     the column reads and writes the dispatcher's statements need (listed
--     below, each with its reason), on the five module tables, the channel
--     account tables the account health/status write goes through
--     (`recordAccountHealth`, owned by `channel_accounts`), the outbox it
--     appends consent events to, and the tenant list.
--   * Its view of `awcms_channel_secrets` is bounded by the RESTRICTIVE policy
--     below: ONLY a `bot_token` that is the own credential of a live, usable
--     `telegram` / `bot` account that has a live endpoint (or a revoked one
--     still owing Telegram a `deleteWebhook`), and ONLY a
--     `webhook_signing_secret` that is the seed of a live endpoint of such an
--     account. Never a WhatsApp, Mailketing or social token, never another
--     purpose, never a secret of a revoked or disabled bot.
--
-- The restrictive policy is ANDed with the permissive tenant-isolation policy
-- of `sql/318`, so a row must also belong to the tenant the transaction is
-- scoped to. `security:readiness` fails if this policy is dropped or widened.
--
-- ## Activation (opt-in, like `awcms_worker`)
--
-- The role ships NOLOGIN and passwordless. A deployment that enables the module
-- activates LOGIN with a secret and points `TELEGRAM_ENGAGEMENT_DATABASE_URL`
-- at it; the job has NO fallback to another connection and refuses to run
-- without it (fail closed).
--
-- Residual risk once activated (ADR-0152 section 10, stated, not removed): a
-- compromised `telegram-engagement:dispatch` that sets the tenant setting can
-- read and decrypt the customer bot tokens of every tenant (and only those).
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_telegram_engagement_dispatch'
  ) THEN
    CREATE ROLE awcms_telegram_engagement_dispatch
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_telegram_engagement_dispatch;

-- The job iterates the active tenants.
GRANT SELECT (id, status) ON awcms_tenants TO awcms_telegram_engagement_dispatch;

-- `fetchAccountRecord` (read by the credential lookup, the capability check and
-- `recordAccountHealth`) and the row policy below. Read-only except the
-- connector's health report, which moves a verified bot to `connected` and a
-- token Telegram rejected to `degraded` (never revoked/disabled/deleted: the
-- health writer refuses those transitions itself).
GRANT SELECT (
  id, tenant_id, business_scope_type, business_scope_id, provider,
  account_kind, external_id, display_name, auth_mode, connection_id,
  parent_account_id, secret_id, status, status_reason, connected_at,
  revoked_at, created_at, updated_at, version, deleted_at
) ON awcms_channel_accounts TO awcms_telegram_engagement_dispatch;
GRANT UPDATE (status, status_reason, connected_at, updated_at, version)
  ON awcms_channel_accounts TO awcms_telegram_engagement_dispatch;

-- `recordAccountHealth`: one upserted row per account. ON CONFLICT DO UPDATE
-- needs the conflict columns AND every column whose EXCLUDED value it reads
-- readable; the row holds no secret.
GRANT SELECT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_telegram_engagement_dispatch;
GRANT INSERT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_telegram_engagement_dispatch;
GRANT UPDATE (
  state, reason_code, checked_at, token_expires_at, quota_remaining,
  quota_limit, updated_at
) ON awcms_channel_account_health TO awcms_telegram_engagement_dispatch;

-- The fail-closed capability check (`resolveCapability`): `inbound` / `dm`.
GRANT SELECT (
  tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
  matrix_version, verified_at, updated_at
) ON awcms_channel_account_capabilities TO awcms_telegram_engagement_dispatch;
GRANT SELECT (id, tenant_id, grant_state)
  ON awcms_channel_provider_connections TO awcms_telegram_engagement_dispatch;

-- The secret store's `resolve` (SELECT ciphertext WHERE tenant, id, purpose).
GRANT SELECT (id, tenant_id, purpose, ciphertext)
  ON awcms_channel_secrets TO awcms_telegram_engagement_dispatch;

-- Endpoints: the connector claims, verifies, activates and fails them; the
-- dispatcher reads the live endpoint and charges its breaker.
GRANT SELECT (
  id, tenant_id, account_id, secret_id, state, provider_action,
  connector_attempts, next_attempt_at, connector_lease_until,
  daily_send_ceiling, breaker_open_until, consecutive_failures
) ON awcms_telegram_engagement_endpoints TO awcms_telegram_engagement_dispatch;
GRANT UPDATE (
  state, provider_action, connector_attempts, next_attempt_at,
  connector_lease_until, last_error_code, verified_bot_id, bot_username,
  verified_at, activated_at, consecutive_failures, breaker_open_until,
  updated_at
) ON awcms_telegram_engagement_endpoints TO awcms_telegram_engagement_dispatch;

-- Contacts: the chat id to deliver to, and the block a provider 403 records.
GRANT SELECT (id, tenant_id, account_id, state, chat_ciphertext, version)
  ON awcms_telegram_engagement_contacts TO awcms_telegram_engagement_dispatch;
GRANT UPDATE (state, blocked_at, version, updated_at)
  ON awcms_telegram_engagement_contacts TO awcms_telegram_engagement_dispatch;

-- Consent: the dispatch-time re-check, and the withdrawal a 403 records.
GRANT SELECT (id, tenant_id, contact_id, purpose, action, method, evidence_seq)
  ON awcms_telegram_engagement_consents TO awcms_telegram_engagement_dispatch;
GRANT INSERT (
  tenant_id, contact_id, purpose, action, notice_version, update_id, method,
  occurred_at, recorded_by
) ON awcms_telegram_engagement_consents TO awcms_telegram_engagement_dispatch;

-- The outbound queue: claim, lease, finalise, expire, cancel.
GRANT SELECT (
  id, tenant_id, account_id, contact_id, purpose, kind, prompt_purpose,
  prompt_notice_version, attempts, lease_token, lease_until, status,
  next_attempt_at, created_at, expires_at, text_ciphertext, sent_at
) ON awcms_telegram_engagement_messages TO awcms_telegram_engagement_dispatch;
GRANT UPDATE (
  status, attempts, lease_until, lease_token, provider_message_id,
  failure_code, text_ciphertext, next_attempt_at, sent_at, finalized_at,
  updated_at
) ON awcms_telegram_engagement_messages TO awcms_telegram_engagement_dispatch;

-- `awcms.telegram_engagement.consent.changed` in the same transaction as the
-- withdrawal (the outbox, ADR-0006), and its per-consumer deliveries.
GRANT INSERT (
  tenant_id, event_type, event_version, aggregate_type, aggregate_id,
  aggregate_version, order_key, correlation_id, causation_id, producer_module,
  schema_ref, actor_tenant_user_id, actor_profile_id, payload, occurred_at
) ON awcms_domain_events TO awcms_telegram_engagement_dispatch;
GRANT SELECT (id, event_sequence)
  ON awcms_domain_events TO awcms_telegram_engagement_dispatch;
GRANT INSERT (
  tenant_id, event_id, event_sequence, event_type, event_version, order_key,
  consumer_name, max_attempts, correlation_id
) ON awcms_domain_event_deliveries TO awcms_telegram_engagement_dispatch;
GRANT SELECT (tenant_id, event_id, consumer_name, replay_of_delivery_id)
  ON awcms_domain_event_deliveries TO awcms_telegram_engagement_dispatch;

-- ---------------------------------------------------------------------------
-- What the role may WRITE, bounded per row (audit M-B of PR #1260). A column
-- grant says WHICH columns; these RESTRICTIVE policies say WHICH ROWS and WHICH
-- VALUES, so the role cannot widen its own view of the secrets (re-enable a
-- disabled bot), touch another module's account, forge consent or forge an
-- unrelated domain event. Each is ANDed with the tenant-isolation policy and
-- pinned exactly (and probed) by `security:readiness`.
-- ---------------------------------------------------------------------------

-- Accounts: only the connector's health report on a live customer bot,
-- moving it to `connected` (verified) or `degraded` (token refused). Never
-- another provider or kind, never a revoked, disabled or deleted account, and
-- never to a status other than those two.
CREATE POLICY awcms_channel_accounts_telegram_engagement_dispatch_update
  ON awcms_channel_accounts
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_telegram_engagement_dispatch
  USING (
    provider = 'telegram'
    AND account_kind = 'bot'
    AND deleted_at IS NULL
    AND status IN ('pending', 'connected', 'degraded')
  )
  WITH CHECK (
    provider = 'telegram'
    AND account_kind = 'bot'
    AND deleted_at IS NULL
    AND status IN ('connected', 'degraded')
  );

-- Health: only the rows of live customer bots (the report above).
CREATE POLICY awcms_channel_account_health_telegram_engagement_dispatch
  ON awcms_channel_account_health
  AS RESTRICTIVE
  FOR ALL
  TO awcms_telegram_engagement_dispatch
  USING (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider = 'telegram'
        AND a.account_kind = 'bot'
        AND a.deleted_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider = 'telegram'
        AND a.account_kind = 'bot'
        AND a.deleted_at IS NULL
    )
  );

-- Consent: the ONLY fact the dispatcher records is the withdrawal a provider
-- 403 (the person blocked the bot) implies. It can never record an opt-in.
CREATE POLICY awcms_telegram_engagement_consents_dispatch_insert
  ON awcms_telegram_engagement_consents
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_telegram_engagement_dispatch
  WITH CHECK (action = 'opt_out' AND method = 'provider_forbidden');

-- Contacts: only `started` -> `blocked` (the same 403). Never un-stop, never
-- un-block, never end.
CREATE POLICY awcms_telegram_engagement_contacts_dispatch_update
  ON awcms_telegram_engagement_contacts
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_telegram_engagement_dispatch
  USING (state = 'started')
  WITH CHECK (state = 'blocked');

-- The outbox: only the event the withdrawal above emits, as this module.
CREATE POLICY awcms_domain_events_telegram_engagement_dispatch_insert
  ON awcms_domain_events
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_telegram_engagement_dispatch
  WITH CHECK (
    producer_module = 'telegram_engagement'
    AND event_type = 'awcms.telegram_engagement.consent.changed'
  );

CREATE POLICY awcms_domain_event_deliveries_tge_dispatch_insert
  ON awcms_domain_event_deliveries
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_telegram_engagement_dispatch
  WITH CHECK (event_type = 'awcms.telegram_engagement.consent.changed');

-- The secret view. KEEP THIS POLICY LAST in the file: review tooling (and the
-- readiness test) re-creates it from the text that follows this point.
DROP POLICY IF EXISTS awcms_channel_secrets_telegram_engagement_dispatch
  ON awcms_channel_secrets;

CREATE POLICY awcms_channel_secrets_telegram_engagement_dispatch
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_telegram_engagement_dispatch
  USING (
    (
      purpose = 'bot_token'
      AND EXISTS (
        SELECT 1
        FROM awcms_channel_accounts a
        JOIN awcms_telegram_engagement_endpoints e
          ON e.tenant_id = a.tenant_id
         AND e.account_id = a.id
        WHERE a.tenant_id = awcms_channel_secrets.tenant_id
          AND a.secret_id = awcms_channel_secrets.id
          AND a.provider = 'telegram'
          AND a.account_kind = 'bot'
          AND a.auth_mode = 'bot_token'
          AND a.deleted_at IS NULL
          AND a.status IN ('pending', 'connected', 'degraded')
          AND (e.state <> 'revoked' OR e.provider_action = 'delete')
      )
    )
    OR (
      purpose = 'webhook_signing_secret'
      AND EXISTS (
        SELECT 1
        FROM awcms_telegram_engagement_endpoints e
        JOIN awcms_channel_accounts a
          ON a.tenant_id = e.tenant_id
         AND a.id = e.account_id
        WHERE e.tenant_id = awcms_channel_secrets.tenant_id
          AND e.secret_id = awcms_channel_secrets.id
          AND e.state <> 'revoked'
          AND a.provider = 'telegram'
          AND a.account_kind = 'bot'
          AND a.deleted_at IS NULL
          AND a.status IN ('pending', 'connected', 'degraded')
      )
    )
  );
