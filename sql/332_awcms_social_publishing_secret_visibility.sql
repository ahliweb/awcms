-- `social_publishing`: provider-aware worker visibility of the channel secrets a
-- PUBLISHING account owns (Issue #1145, ADR-0157 section 6). Forward-only;
-- `sql/322`, `sql/324` and `sql/328` are applied and are NOT edited. This file
-- REPLACES the restrictive policy that `sql/328` created, keeping both of its
-- WhatsApp branches byte for byte and adding two social ones.
--
-- ## Why the widening exists at all
--
-- `sql/328` bounded the rows `awcms_worker` can SEE in `awcms_channel_secrets` to
-- a WhatsApp sender's credential, on purpose: a compromised `whatsapp:dispatch`
-- must not be able to read every tenant's SOCIAL tokens. The social dispatcher
-- (`social-publishing:dispatch`, Issue #1145) is a second job that runs as the
-- same role and must decrypt a tenant-owned PUBLISHING account's token to make
-- the one provider call that is its whole purpose (ADR-0148 section 5 names "the
-- dispatcher must decrypt" as the accepted residual risk of every channel). It
-- cannot see a row the policy hides, so the policy has to learn about it.
--
-- ## The narrowest form that works
--
-- A secret becomes visible to `awcms_worker` only when it is the access token of:
--
--   * a live ACCOUNT of a social provider that CAN publish (`facebook`,
--     `instagram`, `threads`, `tiktok`, `youtube`, `linkedin`) whose OWN
--     `secret_id` it is, or
--   * a CONNECTION of one of those providers that at least one live account
--     points at,
--
-- and in BOTH cases only while that account holds a `publish` capability row in
-- state `granted`. An account nobody approved for publishing keeps its token
-- hidden from the worker, and so does a connection nothing publishing-capable
-- uses. The purpose list from `sql/324` stays (a refresh token, a bot token, a
-- webhook secret, a PKCE verifier and an authorisation code are still hidden).
-- Telegram is deliberately NOT in the list: its credential purpose is
-- `bot_token`, which the purpose list excludes, so a Telegram connector needs its
-- own reviewed change.
--
-- The policy reads only columns the worker already holds under `sql/322`
-- (accounts: `secret_id`, `tenant_id`, `provider`, `connection_id`, `id`,
-- `deleted_at`; connections: `access_secret_id`, `tenant_id`, `provider`;
-- capabilities: `tenant_id`, `account_id`, `capability`, `state`), so NO new
-- grant is needed and none is made. The sub-selects run under the worker's own
-- RLS, which is the same tenant.
--
-- ## What this still does NOT bound (accepted, ADR-0148 section 5, ADR-0157)
--
-- A compromised `social-publishing:dispatch` (it holds the key ring and chooses
-- the tenant setting RLS trusts) can still loop over tenants and decrypt the
-- access token of every PUBLISHING-capable account of every tenant. The bounds
-- that hold are the same as for WhatsApp: a column-only, read-only grant, this
-- row policy, the key ring being outside the database and its backups and
-- granted to the dispatch jobs alone (`scripts/jobs-env-allowlist.ts`),
-- per-tenant decrypt counts, and fast revocation (a revoked account or
-- connection leaves the worker's view at once). `security:readiness` fails if
-- the policy is dropped or stops being provider-aware.
DROP POLICY IF EXISTS awcms_channel_secrets_worker_dispatch_purposes
  ON awcms_channel_secrets;

CREATE POLICY awcms_channel_secrets_worker_dispatch_purposes
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_worker
  USING (
    purpose IN ('provider_access_token', 'api_token', 'device_key')
    AND (
      EXISTS (
        SELECT 1
        FROM awcms_channel_accounts a
        WHERE a.tenant_id = awcms_channel_secrets.tenant_id
          AND a.secret_id = awcms_channel_secrets.id
          AND a.provider IN ('whatsapp_cloud', 'starsender')
          AND a.deleted_at IS NULL
      )
      OR EXISTS (
        SELECT 1
        FROM awcms_channel_provider_connections c
        WHERE c.tenant_id = awcms_channel_secrets.tenant_id
          AND c.access_secret_id = awcms_channel_secrets.id
          AND c.provider = 'whatsapp_cloud'
      )
      OR EXISTS (
        SELECT 1
        FROM awcms_channel_accounts a
        JOIN awcms_channel_account_capabilities k
          ON k.tenant_id = a.tenant_id AND k.account_id = a.id
        WHERE a.tenant_id = awcms_channel_secrets.tenant_id
          AND a.secret_id = awcms_channel_secrets.id
          AND a.provider IN (
            'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
          )
          AND a.deleted_at IS NULL
          AND k.capability = 'publish'
          AND k.state = 'granted'
      )
      OR EXISTS (
        SELECT 1
        FROM awcms_channel_provider_connections c
        JOIN awcms_channel_accounts a
          ON a.tenant_id = c.tenant_id AND a.connection_id = c.id
        JOIN awcms_channel_account_capabilities k
          ON k.tenant_id = a.tenant_id AND k.account_id = a.id
        WHERE c.tenant_id = awcms_channel_secrets.tenant_id
          AND c.access_secret_id = awcms_channel_secrets.id
          AND c.provider IN (
            'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
          )
          AND a.provider = c.provider
          AND a.deleted_at IS NULL
          AND k.capability = 'publish'
          AND k.state = 'granted'
      )
    )
  );
