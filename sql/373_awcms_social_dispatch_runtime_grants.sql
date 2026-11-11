-- social_publishing -- the first connector (Issue #1146, Facebook Pages)
-- ACTIVATES the separate role `awcms_social_dispatch` (sql/358, ADR-0157
-- section 6) for the WHOLE `social-publishing:dispatch` job. Forward-only;
-- sql/330, sql/357 and sql/358 are applied and are NOT edited.
--
-- ## Why the whole job, and not just the credential read
--
-- The job holds `CHANNEL_SECRETS_ENCRYPTION_KEYS` from this change on. If it
-- also held `WORKER_DATABASE_URL` (awcms_worker), the ring would sit next to a
-- login that reads every tenant's WhatsApp sender credentials (sql/328), and a
-- compromised social dispatcher could decrypt them: the very thing ADR-0157
-- section 6 (audit H1) was written to prevent, in the other direction. So the
-- job connects ONLY as `awcms_social_dispatch` (the "dedicated-role job" class
-- of `scripts/jobs-env-allowlist.ts`, which withholds DATABASE_URL,
-- WORKER_DATABASE_URL and SETUP_DATABASE_URL from it), and this file grants the
-- role exactly the column reads and writes the dispatcher's statements need,
-- each with its reason. Still NO table-level privilege anywhere.
--
-- ## What the role may WRITE, bounded per row
--
-- A column grant says WHICH columns; the RESTRICTIVE policies below say WHICH
-- ROWS and WHICH VALUES, so the role cannot widen its own view of the secrets
-- (move an account back to `connected` so its token reappears), retry a failed
-- or unknown job on its own authority (the operator's act, ADR-0157 section 6),
-- cancel a job, forge another module's audit row or emit another module's
-- event. Each is ANDed with the permissive tenant-isolation policy of its table
-- and pinned to its EXACT canonical expression (and probed) by
-- `security:readiness`.
--
-- ## Impact on `whatsapp:dispatch`
--
-- None. `awcms_worker` and its sql/328 policy are untouched; nothing that role
-- can read widens. `awcms_worker` keeps its sql/330 grants on the social tables
-- because the scheduled-publish worker still ENQUEUES through it, and the
-- retention purge (sql/357) still runs as it.
--
-- ## Activation (opt-in, like `awcms_worker`)
--
-- The role still ships NOLOGIN and passwordless. A deployment that enables the
-- module activates LOGIN with a secret and points
-- `SOCIAL_PUBLISHING_DATABASE_URL` at it; the job has NO fallback to another
-- connection and refuses to run without it. The credential path is composed
-- only when `SOCIAL_PUBLISHING_FACEBOOK_ENABLED=true` as well (default off).
--
-- Residual risk once activated (ADR-0157 section 6, stated, not removed): a
-- compromised `social-publishing:dispatch` that sets the tenant setting can read
-- and decrypt the publishing-capable access tokens of every tenant (and only
-- those), and can mark a live social account `degraded`.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

-- The job iterates the active tenants.
GRANT SELECT (id, status) ON awcms_tenants TO awcms_social_dispatch;

-- A tenant that switched the module off is not dispatched (the #1145 audit,
-- M4). Enabled flags only; `disable_reason` and the stamps are not needed.
GRANT SELECT (tenant_id, module_key, enabled)
  ON awcms_tenant_modules TO awcms_social_dispatch;

-- `resolvePublisher` evaluates the capability WITH its evidence and matrix
-- version (sql/358 granted only the state, enough for the secret policy).
GRANT SELECT (evidence_kind, evidence_ref, matrix_version)
  ON awcms_channel_account_capabilities TO awcms_social_dispatch;

-- `recordPublisherCredentialRejected` (channel_accounts, Issue #1146): a token
-- the provider refused degrades the account. `version` is read by
-- `version = version + 1`.
GRANT SELECT (version) ON awcms_channel_accounts TO awcms_social_dispatch;
GRANT UPDATE (status, status_reason, updated_at, version)
  ON awcms_channel_accounts TO awcms_social_dispatch;

-- The same report's health row. ON CONFLICT DO UPDATE needs the conflict
-- columns AND every column whose EXCLUDED value it reads readable; the row
-- holds no secret.
GRANT SELECT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health TO awcms_social_dispatch;
GRANT INSERT (tenant_id, account_id, state, reason_code, checked_at)
  ON awcms_channel_account_health TO awcms_social_dispatch;
GRANT UPDATE (state, reason_code, checked_at, updated_at)
  ON awcms_channel_account_health TO awcms_social_dispatch;

-- The snapshot a claimed job publishes (read-only: a publication is never
-- changed by the dispatcher).
GRANT SELECT (
  id, tenant_id, state, not_before, title, caption, link_url, media_snapshot
) ON awcms_social_publications TO awcms_social_dispatch;

-- The queue: claim (FOR UPDATE, lease), daily cap count, finalise. No INSERT
-- (the dispatcher never enqueues) and no DELETE (retention is the worker's).
GRANT SELECT (
  id, tenant_id, publication_id, channel_account_id, provider, account_kind,
  variant, idempotency_key, status, attempt_count, max_attempts, hold_count,
  next_attempt_at, published_at
) ON awcms_social_publish_jobs TO awcms_social_dispatch;
GRANT UPDATE (
  status, attempt_count, dedupe_key_supported, next_attempt_at,
  external_post_id, external_post_url, published_at, failure_code, last_error,
  hold_count, updated_at
) ON awcms_social_publish_jobs TO awcms_social_dispatch;

-- The append-only attempt ledger (ON CONFLICT (job_id, attempt_no) DO NOTHING).
GRANT SELECT (tenant_id, job_id, attempt_no)
  ON awcms_social_publish_attempts TO awcms_social_dispatch;
GRANT INSERT (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
  ON awcms_social_publish_attempts TO awcms_social_dispatch;

-- The dispatcher's audit rows (`recordAuditEvent`).
GRANT INSERT (
  tenant_id, actor_tenant_user_id, actor_tenant_id, delegated_grant_id,
  module_key, action, resource_type, resource_id, severity, message,
  attributes, correlation_id
) ON awcms_audit_events TO awcms_social_dispatch;

-- `awcms.social_publishing.job.published` / `.failed` in the finalise
-- transaction (the outbox, ADR-0006), and their per-consumer deliveries.
GRANT INSERT (
  tenant_id, event_type, event_version, aggregate_type, aggregate_id,
  aggregate_version, order_key, correlation_id, causation_id, producer_module,
  schema_ref, actor_tenant_user_id, actor_profile_id, payload, occurred_at
) ON awcms_domain_events TO awcms_social_dispatch;
GRANT SELECT (id, event_sequence)
  ON awcms_domain_events TO awcms_social_dispatch;
GRANT INSERT (
  tenant_id, event_id, event_sequence, event_type, event_version, order_key,
  consumer_name, max_attempts, correlation_id
) ON awcms_domain_event_deliveries TO awcms_social_dispatch;
GRANT SELECT (tenant_id, event_id, consumer_name, replay_of_delivery_id)
  ON awcms_domain_event_deliveries TO awcms_social_dispatch;

-- ---------------------------------------------------------------------------
-- Row and value bounds of every write (RESTRICTIVE, TO awcms_social_dispatch).
-- ---------------------------------------------------------------------------

-- Jobs: only a job still in the dispatcher's hands (queued, retry_wait,
-- publishing), and only to a status the dispatcher may set. A failed or
-- needs_reconciliation job is invisible to this UPDATE, so the role can never
-- send one again (only an operator, through the app role, retries it); it can
-- never cancel a job either. `SELECT ... FOR UPDATE` passes through the same
-- USING, so the claim cannot lock anything else.
DROP POLICY IF EXISTS awcms_social_publish_jobs_social_dispatch_update
  ON awcms_social_publish_jobs;

CREATE POLICY awcms_social_publish_jobs_social_dispatch_update
  ON awcms_social_publish_jobs
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_social_dispatch
  USING (status IN ('queued', 'retry_wait', 'publishing'))
  WITH CHECK (
    status IN (
      'queued', 'publishing', 'retry_wait', 'published', 'failed',
      'needs_reconciliation'
    )
  );

-- Accounts: only `connected` -> `degraded` of a live social account (the
-- provider refused its credential). Never to `connected` (that would put a
-- refused token back in the role's view), never a revoked, disabled, pending or
-- deleted account, never another provider.
DROP POLICY IF EXISTS awcms_channel_accounts_social_dispatch_degrade
  ON awcms_channel_accounts;

CREATE POLICY awcms_channel_accounts_social_dispatch_degrade
  ON awcms_channel_accounts
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_social_dispatch
  USING (
    provider IN (
      'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
    )
    AND deleted_at IS NULL
    AND status = 'connected'
  )
  WITH CHECK (
    provider IN (
      'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
    )
    AND deleted_at IS NULL
    AND status = 'degraded'
  );

-- Health: only the rows of live social accounts, and only a failing report
-- (never `ok`, which is how a connector says an account works).
DROP POLICY IF EXISTS awcms_channel_account_health_social_dispatch
  ON awcms_channel_account_health;

CREATE POLICY awcms_channel_account_health_social_dispatch
  ON awcms_channel_account_health
  AS RESTRICTIVE
  FOR ALL
  TO awcms_social_dispatch
  USING (
    EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider IN (
          'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
        )
        AND a.deleted_at IS NULL
    )
  )
  WITH CHECK (
    state = 'failing'
    AND EXISTS (
      SELECT 1 FROM awcms_channel_accounts a
      WHERE a.tenant_id = awcms_channel_account_health.tenant_id
        AND a.id = awcms_channel_account_health.account_id
        AND a.provider IN (
          'facebook', 'instagram', 'threads', 'tiktok', 'youtube', 'linkedin'
        )
        AND a.deleted_at IS NULL
    )
  );

-- Audit: only this module's rows.
DROP POLICY IF EXISTS awcms_audit_events_social_dispatch_insert
  ON awcms_audit_events;

CREATE POLICY awcms_audit_events_social_dispatch_insert
  ON awcms_audit_events
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (module_key = 'social_publishing');

-- The outbox: only the two events the dispatcher emits, as this module.
DROP POLICY IF EXISTS awcms_domain_events_social_dispatch_insert
  ON awcms_domain_events;

CREATE POLICY awcms_domain_events_social_dispatch_insert
  ON awcms_domain_events
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (
    producer_module = 'social_publishing'
    AND event_type IN (
      'awcms.social_publishing.job.published',
      'awcms.social_publishing.job.failed'
    )
  );

DROP POLICY IF EXISTS awcms_domain_event_deliveries_social_dispatch_insert
  ON awcms_domain_event_deliveries;

CREATE POLICY awcms_domain_event_deliveries_social_dispatch_insert
  ON awcms_domain_event_deliveries
  AS RESTRICTIVE
  FOR INSERT
  TO awcms_social_dispatch
  WITH CHECK (
    event_type IN (
      'awcms.social_publishing.job.published',
      'awcms.social_publishing.job.failed'
    )
  );
