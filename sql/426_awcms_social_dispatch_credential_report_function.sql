-- social_publishing / channel_accounts -- the dispatcher's "the provider refused
-- this credential" report moves into ONE fixed-body SECURITY DEFINER function,
-- and `awcms_social_dispatch` loses every direct write on
-- `awcms_channel_accounts` and `awcms_channel_account_health` (the #1145
-- credential-path security review, HIGH). Forward-only; sql/358, sql/373 and
-- sql/386 are applied and are NOT edited.
--
-- ## The finding
--
-- sql/373 granted the role `UPDATE (status, status_reason, updated_at, version)`
-- on the accounts, bounded by a RESTRICTIVE policy that constrained `status`
-- only. A column grant says WHICH columns, not WHAT VALUES: as the role,
-- `UPDATE ... SET status = 'degraded', version = 2147483647` succeeded. The next
-- `version = version + 1` of the app role then raised `integer out of range`:
-- disconnecting the account failed, revoking its connection failed and rolled
-- back the ciphertext deletion with it (the grant and its token stayed alive),
-- and deleting the account is refused while it is `degraded`. A compromised
-- dispatcher could make a live token un-revocable from the product. The same
-- grant let it write any `status_reason` and any `checked_at`.
--
-- ## The fix: the role states a fact, the function decides every value
--
-- `awcms_social_report_credential_rejected(tenant, account)` is the whole write.
-- It takes the two ids of a job the dispatcher already holds and returns one
-- closed code (`DEGRADED`, `UNCHANGED`, `NOT_A_PUBLISHER`); every value it
-- writes is a constant of its body:
--
--   * health row: state `failing`, reason `PUBLISH_CREDENTIAL_REJECTED`,
--     `checked_at = now()` (never a value the caller chose);
--   * account: only `connected` -> `degraded`, reason
--     `PUBLISH_CREDENTIAL_REJECTED`, `updated_at = now()`, `version + 1` (one
--     step per real transition: the role cannot put the account back to
--     `connected`, so it cannot repeat the step to walk the version up);
--   * only a live (not deleted) Facebook Page, the one connector admitted
--     (#1146). A second connector widens this body in its own migration.
--
-- Safeguards (the sql/386 definer pattern):
--
--   * owned by `awcms_social_credential_report`, a NEW role that is NOLOGIN,
--     NOSUPERUSER, NOBYPASSRLS and memberless (security:readiness check 7e),
--     holding column privileges on exactly what the body reads and writes;
--   * `search_path = public, pg_temp`, static SQL, no dynamic statement;
--   * the tenant is bound twice: the argument must equal the transaction's
--     `app.current_tenant_id` (else 42501), and the owner reads and writes under
--     the tables' FORCE RLS tenant policy as well as an explicit `tenant_id =`
--     predicate;
--   * EXECUTE is revoked from PUBLIC and granted to `awcms_social_dispatch`
--     only; security:readiness pins the body, owner, search_path, volatility and
--     the grantee list exactly, and probes the codes and the refused direct
--     writes in a rolled-back transaction.
--
-- The two RESTRICTIVE policies that bounded the old direct writes
-- (`awcms_channel_accounts_social_dispatch_degrade`,
-- `awcms_channel_account_health_social_dispatch`) are dropped with the grants
-- they bounded: a policy naming the role on a table it can no longer write is a
-- reviewed pin with nothing behind it.
--
-- The role keeps its sql/358 READ of the accounts (`status` among it): the
-- dispatcher still resolves a publisher, and the secret policy still reads the
-- account through the role.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_social_credential_report'
  ) THEN
    CREATE ROLE awcms_social_credential_report
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_social_credential_report
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_social_credential_report;

-- Exactly the columns the body reads and writes. `FOR UPDATE` needs an UPDATE
-- privilege on the row, which the column UPDATE grant provides.
GRANT SELECT (
  tenant_id, id, provider, account_kind, status, deleted_at, version
) ON awcms_channel_accounts TO awcms_social_credential_report;
GRANT UPDATE (status, status_reason, updated_at, version)
  ON awcms_channel_accounts TO awcms_social_credential_report;

-- ON CONFLICT DO UPDATE reads the conflict columns and every EXCLUDED column.
GRANT SELECT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health TO awcms_social_credential_report;
GRANT INSERT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health TO awcms_social_credential_report;
GRANT UPDATE (state, reason_code, checked_at, updated_at)
  ON awcms_channel_account_health TO awcms_social_credential_report;

CREATE OR REPLACE FUNCTION awcms_social_report_credential_rejected(
  p_tenant_id uuid,
  p_account_id uuid
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
    RAISE EXCEPTION 'awcms_social_report_credential_rejected: the tenant is not the transaction tenant'
      USING ERRCODE = '42501';
  END IF;

  SELECT a.status
    INTO v_status
  FROM awcms_channel_accounts AS a
  WHERE a.tenant_id = p_tenant_id
    AND a.id = p_account_id
    AND a.provider = 'facebook'
    AND a.account_kind = 'page'
    AND a.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'NOT_A_PUBLISHER';
  END IF;

  INSERT INTO awcms_channel_account_health
    (tenant_id, account_id, state, reason_code, checked_at)
  VALUES
    (p_tenant_id, p_account_id, 'failing', 'PUBLISH_CREDENTIAL_REJECTED', now())
  ON CONFLICT (tenant_id, account_id) DO UPDATE
  SET state = EXCLUDED.state,
      reason_code = EXCLUDED.reason_code,
      checked_at = EXCLUDED.checked_at,
      updated_at = now();

  IF v_status IS DISTINCT FROM 'connected' THEN
    RETURN 'UNCHANGED';
  END IF;

  UPDATE awcms_channel_accounts
  SET status = 'degraded',
      status_reason = 'PUBLISH_CREDENTIAL_REJECTED',
      updated_at = now(),
      version = version + 1
  WHERE tenant_id = p_tenant_id
    AND id = p_account_id
    AND status = 'connected'
    AND deleted_at IS NULL;

  RETURN 'DEGRADED';
END;
$function$;

COMMENT ON FUNCTION awcms_social_report_credential_rejected(uuid, uuid) IS
  'Issue #1145 credential-path review (HIGH). The social dispatcher reports that the provider refused an account''s credential: for a live Facebook Page of the transaction tenant, records a failing health row (reason PUBLISH_CREDENTIAL_REJECTED, checked_at now()) and moves a connected account to degraded (same reason, version + 1). Returns DEGRADED, UNCHANGED (not connected) or NOT_A_PUBLISHER. Every written value is fixed by the body. Raises 42501 when the tenant argument is not app.current_tenant_id. Owner awcms_social_credential_report (column privileges only); EXECUTE for awcms_social_dispatch only.';

REVOKE ALL ON FUNCTION awcms_social_report_credential_rejected(uuid, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_social_report_credential_rejected(uuid, uuid)
  TO awcms_social_dispatch;
ALTER FUNCTION awcms_social_report_credential_rejected(uuid, uuid)
  OWNER TO awcms_social_credential_report;

-- The role's direct writes go, with the policies that bounded them.
REVOKE UPDATE (status, status_reason, updated_at, version)
  ON awcms_channel_accounts FROM awcms_social_dispatch;
REVOKE SELECT (version) ON awcms_channel_accounts FROM awcms_social_dispatch;
REVOKE SELECT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health FROM awcms_social_dispatch;
REVOKE INSERT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health FROM awcms_social_dispatch;
REVOKE UPDATE (state, reason_code, checked_at, updated_at)
  ON awcms_channel_account_health FROM awcms_social_dispatch;

DROP POLICY IF EXISTS awcms_channel_accounts_social_dispatch_degrade
  ON awcms_channel_accounts;
DROP POLICY IF EXISTS awcms_channel_account_health_social_dispatch
  ON awcms_channel_account_health;
