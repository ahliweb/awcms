-- email -- the SEPARATE database role of the scheduled sender-verify job
-- `email:senders:verify` (Issue #1479; ADR-0162 O1, decided by the owner on
-- 24 November 2026 as K19.1; the ADR-0157 section 6 pattern also used by
-- `awcms_social_dispatch` and `awcms_telegram_engagement_dispatch`).
-- Forward-only; `sql/348`, `sql/353` and `sql/416` are applied and NOT edited.
--
-- ## Why a separate role
--
-- ADR-0162 admitted the job as the third scheduled `awcms_app` job, with the
-- app login and `CHANNEL_SECRETS_ENCRYPTION_KEYS` in one cron container. As
-- `awcms_app` a compromised job reads and decrypts EVERY channel secret of every
-- tenant (WhatsApp, Telegram, social, Mailketing, ...) under the tenant setting
-- it chooses. The job needs one thing: the API token of a tenant's Mailketing
-- ESP account (a read-only `GET /credits` and `GET /senders`), plus the right to
-- record what the provider answered.
--
-- So this role, and nothing but this role, runs the job:
--
--   * `awcms_app`, `awcms_worker` and every other role are NOT touched.
--   * `awcms_email_senders_verify` holds NO table-level privilege, only the
--     column reads and writes the job's statements need (each listed below) on
--     the channel account, health and secret tables, the evidence table of
--     `sql/461`, and the tenant list.
--   * Its view of `awcms_channel_secrets` is bounded by a RESTRICTIVE policy to
--     the `api_token` of a live Mailketing `esp_account` (never a WhatsApp,
--     Telegram, social or sender-identity credential, never another purpose,
--     never a deleted or revoked account). Its view of `awcms_channel_accounts`
--     is bounded to Mailketing accounts and sender identities.
--   * Its WRITES are bounded per row AND per value (RESTRICTIVE, below), so it
--     cannot widen its own view of the secrets (re-enable a revoked account,
--     move an account out of the set above, touch another provider) and cannot
--     write a status, a reason or a health state the job never writes.
--
-- Every restrictive policy is ANDed with the permissive tenant-isolation policy
-- of `sql/318`, so a row must also belong to the tenant the transaction is
-- scoped to. `security:readiness` pins each expression EXACTLY and probes the
-- role's behaviour in a rolled-back transaction.
--
-- ## What a column grant does not say, and this file does (audit lesson 12)
--
-- `UPDATE (status, status_reason, ...)` says WHICH columns. The account WITH
-- CHECK says which VALUES (`connected` with no reason, or `degraded` with one of
-- the three fixed reasons the job writes), and the guard trigger says which
-- TRANSITIONS and which counters: pending|degraded -> connected, connected ->
-- degraded, the version +1, `updated_at` = now(), `connected_at` kept or set
-- once. The health policy pairs each state with the reason codes the job writes
-- for that kind of account, and forbids a token expiry or a quota limit.
--
-- ## Activation (opt-in, like the other dedicated roles)
--
-- The role ships NOLOGIN and passwordless. The OPERATOR grants LOGIN and a
-- password, builds `EMAIL_SENDERS_VERIFY_DATABASE_URL` and lists it in the
-- job's scoped environment (docs/awcms/18_configuration_env_reference.md):
--
--   ALTER ROLE awcms_email_senders_verify LOGIN PASSWORD '<secret>';
--
-- The job has NO fallback to `DATABASE_URL` / `WORKER_DATABASE_URL`: a missing
-- value refuses (fail closed). Until then `email:senders:verify` exits non-zero
-- when `EMAIL_SENDER_ROUTING_ENABLED` is `"true"`, exactly as a job without its
-- credential must.
--
-- Residual risk once activated (stated, not removed): a compromised
-- `email:senders:verify` that sets the tenant setting can read and decrypt the
-- Mailketing ESP tokens of every tenant, and move their live accounts between
-- connected and degraded (never a revoked or disabled one). It cannot read any other channel secret.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_email_senders_verify'
  ) THEN
    CREATE ROLE awcms_email_senders_verify
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_email_senders_verify;

-- The job iterates the active tenants.
GRANT SELECT (id, status) ON awcms_tenants TO awcms_email_senders_verify;

-- `fetchAccountRecord`, `loadSenderAccount` and the directory adapter read these
-- (identity, parent, secret reference, status); the row policies below read
-- provider, kind, auth mode and deleted_at. Read-only except the status move
-- `recordAccountHealth` makes (never revoked/disabled/deleted: the health
-- writer refuses those itself and the policy below makes the database refuse).
GRANT SELECT (
  id, tenant_id, business_scope_type, business_scope_id, provider,
  account_kind, external_id, display_name, auth_mode, connection_id,
  parent_account_id, secret_id, status, status_reason, connected_at,
  revoked_at, created_at, updated_at, version, deleted_at
) ON awcms_channel_accounts TO awcms_email_senders_verify;
GRANT UPDATE (status, status_reason, connected_at, updated_at, version)
  ON awcms_channel_accounts TO awcms_email_senders_verify;

-- `recordAccountHealth`: one upserted row per account. ON CONFLICT DO UPDATE
-- needs the conflict columns AND every column whose EXCLUDED value it reads.
GRANT SELECT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_email_senders_verify;
GRANT INSERT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_email_senders_verify;
GRANT UPDATE (
  state, reason_code, checked_at, token_expires_at, quota_remaining,
  quota_limit, updated_at
) ON awcms_channel_account_health TO awcms_email_senders_verify;

-- The secret store's `resolve` (SELECT ciphertext WHERE tenant, id, purpose) and
-- the credential adapter's version read (the "token replaced while probing"
-- check). No write: the role can neither replace nor delete a secret.
GRANT SELECT (id, tenant_id, purpose, ciphertext, version)
  ON awcms_channel_secrets TO awcms_email_senders_verify;

-- ---------------------------------------------------------------------------
-- What the role may READ, bounded per row.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS awcms_channel_accounts_email_senders_verify_select
  ON awcms_channel_accounts;

CREATE POLICY awcms_channel_accounts_email_senders_verify_select
  ON awcms_channel_accounts
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_email_senders_verify
  USING (
    provider = 'mailketing'
    AND account_kind IN ('esp_account', 'sender_identity')
  );

-- ---------------------------------------------------------------------------
-- What the role may WRITE, bounded per row and per value.
-- ---------------------------------------------------------------------------

-- Accounts: only the verification report's status move on a live Mailketing
-- account or sender, to `connected` (no reason) or `degraded` (one of the three
-- fixed reasons the job writes). Never another provider or kind, never a
-- revoked, disabled or deleted account, never a free-text reason. The USING
-- status set equals the WITH CHECK status set, so the role can neither enter
-- nor leave the view of the secret policy below by an UPDATE.
DROP POLICY IF EXISTS awcms_channel_accounts_email_senders_verify_update
  ON awcms_channel_accounts;

CREATE POLICY awcms_channel_accounts_email_senders_verify_update
  ON awcms_channel_accounts
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_email_senders_verify
  USING (
    provider = 'mailketing'
    AND account_kind IN ('esp_account', 'sender_identity')
    AND deleted_at IS NULL
    AND status IN ('pending', 'connected', 'degraded')
  )
  WITH CHECK (
    provider = 'mailketing'
    AND account_kind IN ('esp_account', 'sender_identity')
    AND deleted_at IS NULL
    AND (
      (status = 'connected' AND status_reason IS NULL)
      OR (
        status = 'degraded'
        AND status_reason IN (
          'CREDENTIAL_REJECTED', 'CREDIT_DEPLETED', 'SENDER_UNVERIFIED'
        )
      )
    )
  );

-- Transitions, counters and stamps (a row policy cannot compare OLD with NEW).
-- Fires only for this role; every other role is untouched.
CREATE OR REPLACE FUNCTION awcms_channel_accounts_email_senders_verify_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user <> 'awcms_email_senders_verify' THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status IN ('pending', 'degraded') AND NEW.status = 'connected')
    OR (OLD.status = 'connected' AND NEW.status = 'degraded')
  ) THEN
    RAISE EXCEPTION 'the sender verification role may only move a channel account pending|degraded -> connected or connected -> degraded'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version IS DISTINCT FROM OLD.version + 1
     OR NEW.updated_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'the sender verification role must advance the version by one and stamp updated_at with now()'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'connected' THEN
    IF NEW.connected_at IS DISTINCT FROM COALESCE(OLD.connected_at, now()) THEN
      RAISE EXCEPTION 'the sender verification role may only set connected_at once, to now()'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.connected_at IS DISTINCT FROM OLD.connected_at THEN
    RAISE EXCEPTION 'the sender verification role may not change connected_at on a degrade'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_channel_accounts_email_senders_verify_guard
  ON awcms_channel_accounts;

CREATE TRIGGER awcms_channel_accounts_email_senders_verify_guard
  BEFORE UPDATE ON awcms_channel_accounts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_accounts_email_senders_verify_guard();

-- Health: only the rows of live, not revoked or disabled Mailketing accounts (the
-- statuses the job lists), and only a (state, reason)
-- pair the job writes for that kind of account: an ESP account reports the
-- credit balance (`ok` with a balance, `failing` CREDENTIAL_REJECTED, `degraded`
-- CREDIT_DEPLETED, `unknown` CREDIT_RESPONSE_UNRECOGNISED); a sender identity
-- reports the provider's verdict (`ok`, `degraded` SENDER_UNVERIFIED, `unknown`
-- with one of three codes). A lost claim (ADR-0170) is `failing` with
-- ACCOUNT_ALREADY_REGISTERED on either. No token expiry, no quota limit, and
-- only an ESP account carries a (non-negative) remaining balance.
DROP POLICY IF EXISTS awcms_channel_account_health_email_senders_verify
  ON awcms_channel_account_health;

CREATE POLICY awcms_channel_account_health_email_senders_verify
  ON awcms_channel_account_health
  AS RESTRICTIVE
  FOR ALL
  TO awcms_email_senders_verify
  USING (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider = 'mailketing'
        AND a.account_kind IN ('esp_account', 'sender_identity')
        AND a.deleted_at IS NULL
        AND a.status IN ('pending', 'connected', 'degraded')
    )
  )
  WITH CHECK (
    token_expires_at IS NULL
    AND quota_limit IS NULL
    AND EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider = 'mailketing'
        AND a.deleted_at IS NULL
        AND a.status IN ('pending', 'connected', 'degraded')
        AND (
          (
            a.account_kind = 'esp_account'
            AND (quota_remaining IS NULL OR quota_remaining >= 0)
            AND (
              (state = 'ok' AND reason_code IS NULL)
              OR (state = 'failing' AND reason_code IN (
                'CREDENTIAL_REJECTED', 'ACCOUNT_ALREADY_REGISTERED'))
              OR (state = 'degraded' AND reason_code = 'CREDIT_DEPLETED')
              OR (state = 'unknown'
                  AND reason_code = 'CREDIT_RESPONSE_UNRECOGNISED')
            )
          )
          OR (
            a.account_kind = 'sender_identity'
            AND quota_remaining IS NULL
            AND (
              (state = 'ok' AND reason_code IS NULL)
              OR (state = 'failing'
                  AND reason_code = 'ACCOUNT_ALREADY_REGISTERED')
              OR (state = 'degraded' AND reason_code = 'SENDER_UNVERIFIED')
              OR (state = 'unknown' AND reason_code IN (
                'SENDER_STATUS_AMBIGUOUS', 'SENDER_LIST_UNRECOGNISED',
                'ACCOUNT_CREDENTIAL_REJECTED'))
            )
          )
        )
    )
  );

-- The secret view. KEEP THIS POLICY LAST in the file: review tooling re-creates
-- it from the text that follows this point.
DROP POLICY IF EXISTS awcms_channel_secrets_email_senders_verify
  ON awcms_channel_secrets;

CREATE POLICY awcms_channel_secrets_email_senders_verify
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_email_senders_verify
  USING (
    purpose = 'api_token'
    AND EXISTS (
      SELECT 1
      FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_secrets.tenant_id
        AND a.secret_id = awcms_channel_secrets.id
        AND a.provider = 'mailketing'
        AND a.account_kind = 'esp_account'
        AND a.auth_mode = 'api_token'
        AND a.deleted_at IS NULL
        AND a.status IN ('pending', 'connected', 'degraded')
    )
  );

COMMENT ON ROLE awcms_email_senders_verify IS
  'Login of the scheduled job email:senders:verify (Issue #1479, ADR-0162 O1): reads the Mailketing ESP token and records account and sender health, bounded per row and value by restrictive policies. Ships NOLOGIN; the operator grants LOGIN.';
