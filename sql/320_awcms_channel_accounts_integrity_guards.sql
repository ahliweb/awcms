-- `channel_accounts` integrity guards (Issue #1140, ADR-0148 I1, I3, T1, T13).
--
-- Defence in depth for four facts the application already maintains, so that a
-- defect (or a compromised role) cannot quietly rewrite them. Each is enforced by
-- the database for EVERY role including the table owner, because none of them is
-- something maintenance ever needs to change:
--
--   * An account's identity (tenant, provider, kind, external id) is IMMUTABLE.
--     "Stable external identity" is the whole point of the registry: re-pointing
--     an existing row at another page or number would carry its capability
--     evidence, assignments and history onto an account nobody approved. A wrong
--     identity is fixed by creating a new account.
--   * A deleted account is terminal. It cannot come back (a restore would have to
--     re-claim a live (provider, external id) that another tenant may now hold).
--   * A secret row's tenant and purpose never change, and its version only moves
--     forward, so a ciphertext cannot be re-labelled as a different kind of
--     credential or rolled back to an older one.
--   * An OAuth state is single-use: once consumed it is frozen, and its hash,
--     tenant and initiator never change. A consumed state therefore cannot be
--     replayed or re-bound to a different person.
--   * A webhook subscription's callback token hash and provider are immutable; a
--     compromised token is replaced by a new subscription, not edited.
--
-- Pure DDL, no rows written. Every function pins `search_path`.

CREATE OR REPLACE FUNCTION awcms_channel_accounts_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.account_kind IS DISTINCT FROM OLD.account_kind
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel account identity (tenant, provider, kind, external id) is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted channel account is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_accounts_identity_guard
  BEFORE UPDATE ON awcms_channel_accounts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_accounts_identity_guard();

CREATE OR REPLACE FUNCTION awcms_channel_secrets_immutability_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel secret tenant, purpose and id are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.version < OLD.version THEN
    RAISE EXCEPTION 'a channel secret version only moves forward'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_secrets_immutability_guard
  BEFORE UPDATE ON awcms_channel_secrets
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_secrets_immutability_guard();

CREATE OR REPLACE FUNCTION awcms_channel_oauth_states_single_use_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.state_hash IS DISTINCT FROM OLD.state_hash
     OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.redirect_uri_hash IS DISTINCT FROM OLD.redirect_uri_hash THEN
    RAISE EXCEPTION 'an OAuth state tenant, hash, initiator, provider and redirect are immutable'
      USING ERRCODE = '23514';
  END IF;

  -- Frozen once consumed. The single exception is the PKCE verifier reference
  -- clearing itself (ON DELETE SET NULL) when whoever finishes the token exchange
  -- deletes the verifier.
  IF OLD.consumed_at IS NOT NULL
     AND (
       NEW.consumed_at IS DISTINCT FROM OLD.consumed_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.requested_scopes IS DISTINCT FROM OLD.requested_scopes
       OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
       OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id
       OR (NEW.pkce_secret_id IS DISTINCT FROM OLD.pkce_secret_id
           AND NEW.pkce_secret_id IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'a consumed OAuth state is single-use and frozen'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_oauth_states_single_use_guard
  BEFORE UPDATE ON awcms_channel_oauth_states
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_oauth_states_single_use_guard();

CREATE OR REPLACE FUNCTION awcms_channel_webhook_subscriptions_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.callback_token_hash IS DISTINCT FROM OLD.callback_token_hash THEN
    RAISE EXCEPTION 'a webhook subscription account, provider and callback token are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_webhook_subscriptions_identity_guard
  BEFORE UPDATE ON awcms_channel_webhook_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_webhook_subscriptions_identity_guard();

CREATE OR REPLACE FUNCTION awcms_channel_provider_connections_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.auth_mode IS DISTINCT FROM OLD.auth_mode
     OR NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
     OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a provider connection tenant, provider, auth mode and business scope are immutable'
      USING ERRCODE = '23514';
  END IF;

  -- A revoked grant is terminal: re-authorising creates a NEW connection, so a
  -- revocation can never be silently undone by an UPDATE.
  IF OLD.grant_state = 'revoked' AND NEW.grant_state <> 'revoked' THEN
    RAISE EXCEPTION 'a revoked provider connection is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_provider_connections_identity_guard
  BEFORE UPDATE ON awcms_channel_provider_connections
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_provider_connections_identity_guard();
