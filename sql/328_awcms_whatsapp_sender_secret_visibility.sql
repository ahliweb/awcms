-- `whatsapp_delivery` sender routing: provider-aware worker visibility of
-- channel secrets (Issue #1233, residual finding H1 of the independent audit of
-- Issue #1230). Forward-only; `sql/322` and `sql/324` are applied and are NOT
-- edited. This file REPLACES the restrictive policy that `sql/324` created.
--
-- ## The gap this closes
--
-- `sql/324` bounded the rows `awcms_worker` can SEE in `awcms_channel_secrets` by
-- PURPOSE only (`provider_access_token`, `api_token`, `device_key`). Those
-- purposes also belong to Facebook, Instagram, Threads, TikTok, YouTube and
-- LinkedIn connections and to Mailketing. A compromised `whatsapp:dispatch` (it
-- holds the key ring `CHANNEL_SECRETS_ENCRYPTION_KEYS`, and it chooses the tenant
-- setting RLS trusts) could therefore loop over tenants, SELECT those rows and
-- decrypt every tenant's SOCIAL and EMAIL tokens. ADR-0148 section 5 accepts only
-- the tenants' WHATSAPP SENDER credentials.
--
-- ## The fix
--
-- A secret is visible to `awcms_worker` only when something the dispatcher is
-- entitled to resolve points at it:
--
--   * a live `whatsapp_cloud` or `starsender` ACCOUNT's own credential
--     (`awcms_channel_accounts.secret_id`), or
--   * the access-token reference of a `whatsapp_cloud` CONNECTION
--     (`awcms_channel_provider_connections.access_secret_id`), which a WhatsApp
--     phone number borrows from its parent WABA.
--
-- The purpose list stays (defence in depth: a refresh token that a WhatsApp
-- connection holds is still hidden). The policy reads only columns the worker
-- already holds (`secret_id`, `tenant_id`, `provider`, `deleted_at` of accounts;
-- `access_secret_id`, `tenant_id`, `provider` of connections), so NO new grant is
-- needed and none is made. The sub-selects run under the worker's own RLS, which
-- is the same tenant.
--
-- ## What this still does NOT bound (accepted, ADR-0148 section 5)
--
-- A compromised worker can still read and decrypt the WhatsApp sender credential
-- of ANY tenant, because it chooses the tenant. The in-process decrypt counter is
-- telemetry in the worker's own process: a compromised process can skip, reset or
-- ignore it, so it bounds nothing. The bounds that hold are the column-only
-- read-only grant, this provider-aware row policy, the key ring being outside the
-- database and its backups and granted to this job alone, and fast revocation.
-- `security:readiness` fails if this policy is dropped or weakened.
--
-- Why not a SECURITY DEFINER resolver keyed by message id and lease token: it
-- would narrow the read to one row at a time, but the resolver would still be
-- callable by a worker that holds a lease on any message of any tenant, the
-- worker can claim rows itself, and the credential port resolves BEFORE a row is
-- claimed (account-level availability). It would add a privileged code path and a
-- reshaped port for a bound the claim does not actually give. The row policy is
-- the smaller, verifiable change.
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
    )
  );
