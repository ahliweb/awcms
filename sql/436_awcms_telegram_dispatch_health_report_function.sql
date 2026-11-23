-- telegram_engagement / channel_accounts -- defence in depth: the customer
-- Telegram dispatcher's dedicated role (`awcms_telegram_engagement_dispatch`,
-- sql/353) records a bot's health through ONE fixed-body SECURITY DEFINER
-- function instead of direct column writes on `awcms_channel_accounts` and
-- `awcms_channel_account_health`. Forward-only; sql/353 and sql/374 are applied
-- and are NOT edited. The same boundary the social dispatcher received in
-- sql/426.
--
-- ## Why
--
-- A column grant says WHICH columns a role may write, not WHAT VALUES. sql/353
-- granted the role `UPDATE (status, status_reason, connected_at, updated_at,
-- version)` on the accounts and INSERT/UPDATE on the health row, bounded by
-- RESTRICTIVE policies that constrained the provider, the kind and the status
-- only. The values of `version`, `status_reason`, `connected_at`, `checked_at`
-- and the quota columns were therefore the role's to choose, and the app role's
-- own `version = version + 1` on the same row depends on `version`. A dedicated
-- role should hold no more than the facts it reports.
--
-- ## The fix
--
-- `awcms_telegram_engagement_report_bot_health(tenant, account, verdict)` is the whole
-- write. The verdict is one of three closed codes the dispatcher already uses:
--
--   * `OK` (a verified `getMe`): a `pending` or `degraded` bot becomes
--     `connected` (`status_reason` cleared, `connected_at` kept or now());
--   * `TOKEN_REJECTED`, `BOT_IDENTITY_MISMATCH`: a `connected` bot becomes
--     `degraded` with that code as its reason;
--
-- and in every case the health row is `ok`/`failing` with that code, checked
-- at `now()`, no token expiry and no quota (what the dispatcher wrote before).
-- `version` moves by one per real status change. Only a live Telegram bot of
-- the transaction tenant; anything else is `NOT_A_BOT`; any other verdict is
-- refused (22023).
--
-- Safeguards (the sql/386 / sql/426 definer pattern): owner
-- `awcms_telegram_engagement_health_report`, NOLOGIN, NOSUPERUSER, NOBYPASSRLS, memberless
-- (security:readiness check 7e), column privileges on exactly what the body
-- reads and writes; `search_path = public, pg_temp`; static SQL; the tenant
-- argument must equal `app.current_tenant_id` (42501) and every statement also
-- names `tenant_id`; EXECUTE revoked from PUBLIC and granted to the dispatch role
-- only; security:readiness pins body, owner, search_path, volatility and the
-- EXECUTE list, and probes the codes and the refused direct writes.
--
-- ## Contacts
--
-- The role keeps `UPDATE (state, blocked_at, version, updated_at)` on
-- `awcms_telegram_engagement_contacts` (it marks a contact `blocked` under the
-- row lock that orders consent evidence, and `FOR UPDATE` needs an UPDATE
-- privilege). A BEFORE UPDATE trigger now fixes `version` to `OLD.version + 1`
-- whenever this role updates a contact, whatever the statement wrote; the sql/353
-- policy already limits the role to one `started -> blocked` step per contact.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_telegram_engagement_health_report'
  ) THEN
    CREATE ROLE awcms_telegram_engagement_health_report
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_telegram_engagement_health_report
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_telegram_engagement_health_report;

GRANT SELECT (
  tenant_id, id, provider, account_kind, status, deleted_at, connected_at,
  version
) ON awcms_channel_accounts TO awcms_telegram_engagement_health_report;
GRANT UPDATE (status, status_reason, connected_at, updated_at, version)
  ON awcms_channel_accounts TO awcms_telegram_engagement_health_report;

GRANT SELECT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_telegram_engagement_health_report;
GRANT INSERT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health TO awcms_telegram_engagement_health_report;
GRANT UPDATE (
  state, reason_code, checked_at, token_expires_at, quota_remaining,
  quota_limit, updated_at
) ON awcms_channel_account_health TO awcms_telegram_engagement_health_report;

CREATE OR REPLACE FUNCTION awcms_telegram_engagement_report_bot_health(
  p_tenant_id uuid,
  p_account_id uuid,
  p_verdict text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_tenant_id IS NULL OR p_account_id IS NULL
     OR p_tenant_id IS DISTINCT FROM
        NULLIF(current_setting('app.current_tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'awcms_telegram_engagement_report_bot_health: the tenant is not the transaction tenant'
      USING ERRCODE = '42501';
  END IF;

  IF p_verdict IS NULL
     OR p_verdict NOT IN ('OK', 'TOKEN_REJECTED', 'BOT_IDENTITY_MISMATCH') THEN
    RAISE EXCEPTION 'awcms_telegram_engagement_report_bot_health: unknown verdict'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.status
    INTO v_status
  FROM awcms_channel_accounts AS a
  WHERE a.tenant_id = p_tenant_id
    AND a.id = p_account_id
    AND a.provider = 'telegram'
    AND a.account_kind = 'bot'
    AND a.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'NOT_A_BOT';
  END IF;

  INSERT INTO awcms_channel_account_health
    (tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
     quota_remaining, quota_limit)
  VALUES
    (p_tenant_id, p_account_id,
     CASE WHEN p_verdict = 'OK' THEN 'ok' ELSE 'failing' END,
     CASE WHEN p_verdict = 'OK' THEN NULL ELSE p_verdict END,
     now(), NULL, NULL, NULL)
  ON CONFLICT (tenant_id, account_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      checked_at = EXCLUDED.checked_at,
      token_expires_at = EXCLUDED.token_expires_at,
      quota_remaining = EXCLUDED.quota_remaining,
      quota_limit = EXCLUDED.quota_limit,
      updated_at = now();

  IF p_verdict = 'OK' THEN
    IF v_status NOT IN ('pending', 'degraded') THEN
      RETURN 'UNCHANGED';
    END IF;

    UPDATE awcms_channel_accounts
    SET status = 'connected',
        status_reason = NULL,
        connected_at = COALESCE(connected_at, now()),
        updated_at = now(),
        version = version + 1
    WHERE tenant_id = p_tenant_id
      AND id = p_account_id
      AND status IN ('pending', 'degraded')
      AND deleted_at IS NULL;

    RETURN 'CONNECTED';
  END IF;

  IF v_status IS DISTINCT FROM 'connected' THEN
    RETURN 'UNCHANGED';
  END IF;

  UPDATE awcms_channel_accounts
  SET status = 'degraded',
      status_reason = p_verdict,
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id
    AND id = p_account_id
    AND status = 'connected'
    AND deleted_at IS NULL;

  RETURN 'DEGRADED';
END;
$function$;

COMMENT ON FUNCTION awcms_telegram_engagement_report_bot_health(uuid, uuid, text) IS
  'Defence in depth for the customer Telegram dispatcher. Records the health of a live Telegram bot of the transaction tenant from one closed verdict (OK, TOKEN_REJECTED, BOT_IDENTITY_MISMATCH): the health row (ok/failing, checked_at now()) and, on a real transition, the account status (pending/degraded -> connected, or connected -> degraded with the verdict as reason; version + 1). Returns CONNECTED, DEGRADED, UNCHANGED or NOT_A_BOT. Every written value is fixed by the body. Raises 42501 when the tenant argument is not app.current_tenant_id and 22023 for another verdict. Owner awcms_telegram_engagement_health_report (column privileges only); EXECUTE for awcms_telegram_engagement_dispatch only.';

REVOKE ALL ON FUNCTION awcms_telegram_engagement_report_bot_health(uuid, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_telegram_engagement_report_bot_health(uuid, uuid, text)
  TO awcms_telegram_engagement_dispatch;
ALTER FUNCTION awcms_telegram_engagement_report_bot_health(uuid, uuid, text)
  OWNER TO awcms_telegram_engagement_health_report;

-- The role's direct writes go, with the policies that bounded them. It keeps
-- its sql/353 READ of the accounts (the capability check reads them).
REVOKE UPDATE (status, status_reason, connected_at, updated_at, version)
  ON awcms_channel_accounts FROM awcms_telegram_engagement_dispatch;
REVOKE SELECT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health FROM awcms_telegram_engagement_dispatch;
REVOKE INSERT (
  tenant_id, account_id, state, reason_code, checked_at, token_expires_at,
  quota_remaining, quota_limit
) ON awcms_channel_account_health FROM awcms_telegram_engagement_dispatch;
REVOKE UPDATE (
  state, reason_code, checked_at, token_expires_at, quota_remaining,
  quota_limit, updated_at
) ON awcms_channel_account_health FROM awcms_telegram_engagement_dispatch;

DROP POLICY IF EXISTS awcms_channel_accounts_telegram_engagement_dispatch_update
  ON awcms_channel_accounts;
DROP POLICY IF EXISTS awcms_channel_account_health_telegram_engagement_dispatch
  ON awcms_channel_account_health;

-- Contacts: the role's `version` is always OLD + 1, whatever it wrote.
CREATE OR REPLACE FUNCTION awcms_telegram_engagement_contacts_dispatch_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user = 'awcms_telegram_engagement_dispatch' THEN
    NEW.version := OLD.version + 1;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_telegram_engagement_contacts_dispatch_version
  ON awcms_telegram_engagement_contacts;

CREATE TRIGGER awcms_telegram_engagement_contacts_dispatch_version
  BEFORE UPDATE ON awcms_telegram_engagement_contacts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_engagement_contacts_dispatch_version();
