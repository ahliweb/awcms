-- social_publishing -- the SEPARATE database role through which the social
-- dispatcher may read a publishing token (Issue #1145, ADR-0157 section 6, the
-- condition for the first connector #1146). Forward-only.
--
-- ## Why a separate role
--
-- `whatsapp:dispatch` runs as `awcms_worker` with the channel key ring. The
-- withdrawn first revision of ADR-0157 widened `awcms_worker`'s view of
-- `awcms_channel_secrets` to social tokens, which would have let a compromised
-- WhatsApp worker decrypt every tenant's Facebook, Instagram, Threads, TikTok,
-- YouTube and LinkedIn tokens (audit finding H1). This file does the opposite:
--
--   * `awcms_worker` and its `sql/328` policy are NOT touched. Nothing that role
--     can read widens. The WhatsApp worker still cannot see a social token.
--   * `awcms_social_dispatch` is a NEW role that can read ONLY the channel columns
--     the publish-credential resolution needs, and ONLY the access token of a
--     social account that may publish right now (below). It has no privilege on
--     any other table: not the social queue, not a WhatsApp table, nothing.
--
-- ## What the row policy admits (M2 and L10 of the #1145 audit)
--
-- A secret row is visible to `awcms_social_dispatch` only when ALL of:
--
--   * its purpose is `provider_access_token` (never a refresh token, PKCE
--     verifier, authorisation code, webhook secret, bot token, API token or
--     device key);
--   * it is the `access_secret_id` of a provider CONNECTION of one of the six
--     social publishing providers (facebook, instagram, threads, tiktok, youtube,
--     linkedin) whose grant is `active` or `expired` (M2: never `revoked`,
--     `failed` or `pending`);
--   * an ACCOUNT of the same provider uses that connection directly
--     (`connection_id`), is not deleted, is `connected` or `degraded` (M2: never
--     `revoked`, `disabled`, `pending` or `deleted`), and holds a `publish`
--     capability whose state is `granted`.
--
-- A revoked account, a revoked connection or a withdrawn capability leaves the
-- role's view in the same statement that records it: the policy is evaluated per
-- read, there is nothing to invalidate.
--
-- L10: an account that would BORROW its credential from a parent container is
-- not admitted (the policy is keyed on the account's OWN `connection_id`). None
-- of the six providers has a container kind today (provider matrix), and if one
-- gains it, the credential adapter's lookup through the parent finds no row
-- under this role and answers `CREDENTIAL_UNAVAILABLE`, which is the refusal the
-- ADR asks for. Widening that is a new migration and a new review.
--
-- ## Activation (opt-in, like `awcms_worker`)
--
-- The role ships NOLOGIN and passwordless. Nothing in this change connects as it,
-- and no job is granted the key ring for it: the first connector (#1146) does
-- that, together with its own connection string, and only after the human
-- security review of the credential path. Until then the role exists, is pinned
-- by `security:readiness`, and grants nothing to anyone.
--
-- Residual risk once activated (ADR-0157 section 6, stated, not removed): a
-- compromised `social-publishing:dispatch` that sets the tenant setting can read
-- and decrypt the publishing-capable access tokens of every tenant.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_social_dispatch'
  ) THEN
    CREATE ROLE awcms_social_dispatch
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_social_dispatch;

-- Exactly what `resolvePublishCredential` (channel-sender-credential-adapter.ts)
-- and the row policy below read. Column-only, read-only.
GRANT SELECT (
  id, tenant_id, business_scope_type, business_scope_id, provider,
  account_kind, external_id, auth_mode, connection_id, parent_account_id,
  secret_id, status, deleted_at
) ON awcms_channel_accounts TO awcms_social_dispatch;

GRANT SELECT (tenant_id, account_id, capability, state)
  ON awcms_channel_account_capabilities TO awcms_social_dispatch;

GRANT SELECT (
  id, tenant_id, provider, grant_state, access_secret_id, expires_at
) ON awcms_channel_provider_connections TO awcms_social_dispatch;

GRANT SELECT (id, tenant_id, purpose, ciphertext)
  ON awcms_channel_secrets TO awcms_social_dispatch;

DROP POLICY IF EXISTS awcms_channel_secrets_social_dispatch_publish
  ON awcms_channel_secrets;

CREATE POLICY awcms_channel_secrets_social_dispatch_publish
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_social_dispatch
  USING (
    purpose = 'provider_access_token'
    AND EXISTS (
      SELECT 1
      FROM awcms_channel_provider_connections c
      JOIN awcms_channel_accounts a
        ON a.tenant_id = c.tenant_id
       AND a.connection_id = c.id
       AND a.provider = c.provider
      JOIN awcms_channel_account_capabilities k
        ON k.tenant_id = a.tenant_id
       AND k.account_id = a.id
      WHERE c.tenant_id = awcms_channel_secrets.tenant_id
        AND c.access_secret_id = awcms_channel_secrets.id
        AND c.provider IN (
          'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
        )
        AND c.grant_state IN ('active', 'expired')
        AND a.deleted_at IS NULL
        AND a.status IN ('connected', 'degraded')
        AND k.capability = 'publish'
        AND k.state = 'granted'
    )
  );
