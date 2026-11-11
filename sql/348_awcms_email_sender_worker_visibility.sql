-- `email` sender routing: what `email:dispatch` (running as `awcms_worker`) may
-- read to send as a tenant-owned Mailketing sender (Issue #1160, ADR-0151
-- section 2 and M5, ADR-0148 section 5). Forward-only; `sql/322`, `sql/324` and
-- `sql/328` are applied and are NOT edited. This file REPLACES the restrictive
-- secret policy `sql/328` created (`DROP POLICY` then `CREATE POLICY`, the same
-- shape `sql/328` used on `sql/324`'s).
--
-- ## Why the dispatcher must see a Mailketing token at all
--
-- ADR-0151 section 2 applies the ADR-0148 section 5 amendment to TENANT-OWNED
-- EMAIL accounts: the dispatcher resolves the sender and decrypts the account's
-- API token in memory, inside the send call, for the claimed row's tenant. The
-- token of a Mailketing `esp_account` is the only email credential that exists
-- (a `sender_identity` holds none and borrows its parent's, exactly as a WABA
-- phone number borrows its WABA's connection).
--
-- ## What this widens, and what it does not
--
-- `sql/328` made a secret visible to `awcms_worker` only when a live WhatsApp
-- account or a `whatsapp_cloud` connection points at it. This adds ONE more
-- source: the `api_token` of a live Mailketing `esp_account`. Unchanged:
--
--   * the purpose list (a refresh token, webhook secret, PKCE verifier,
--     authorisation code and bot token stay invisible);
--   * every social provider (Facebook, Instagram, Threads, TikTok, YouTube,
--     LinkedIn): still invisible to the worker, and `security:readiness` still
--     fails if any of them appears in this policy;
--   * the residual risk ADR-0148 section 5 accepts, now for email too: a
--     compromised worker that holds the key ring and chooses the tenant can
--     read and decrypt that tenant's WhatsApp sender AND Mailketing account
--     credentials. The bounds that hold are the column-only read-only grant,
--     this provider-aware row policy, the key ring outside the database and its
--     backups and granted only to the dispatch jobs, and fast revocation (a
--     revoked secret is hard-deleted).
--
-- The policy still reads only columns the worker already holds (`secret_id`,
-- `tenant_id`, `provider`, `account_kind`, `deleted_at` of accounts;
-- `access_secret_id`, `tenant_id`, `provider` of connections), so no new grant
-- is needed for it.
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
      OR (
        awcms_channel_secrets.purpose = 'api_token'
        AND EXISTS (
          SELECT 1
          FROM awcms_channel_accounts a
          WHERE a.tenant_id = awcms_channel_secrets.tenant_id
            AND a.secret_id = awcms_channel_secrets.id
            AND a.provider = 'mailketing'
            AND a.account_kind = 'esp_account'
            AND a.deleted_at IS NULL
        )
      )
    )
  );

-- ## Sender verification and credit, read at dispatch
--
-- The dispatcher refuses (holds) a tenant sender whose verification is stale or
-- unknown, or whose Mailketing account's last reported credit is below the
-- floor (ADR-0151 sections 1 and 6). Both facts are the latest
-- `awcms_channel_account_health` rows `email:senders:verify` writes. READ-ONLY
-- and column-only: the state, the fixed reason code, when it was checked and the
-- reported balance. Not the token expiry, not the quota limit, and no write of
-- any kind (a worker that could write health could mark an unverified sender
-- verified).
GRANT SELECT (tenant_id, account_id, state, reason_code, checked_at,
              quota_remaining)
  ON awcms_channel_account_health TO awcms_worker;

-- `awcms_email_sender_policies` is deliberately NOT granted to the worker. The
-- dispatcher never reads it (the sender is pinned on the row at enqueue), and the
-- only worker that enqueues email (`hr_workforce`'s notices, `sql/302`) uses the
-- deployment sender and cannot even name a sender column (its INSERT grant is
-- column-scoped to the ten pre-routing columns).
