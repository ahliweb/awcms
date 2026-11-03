-- social_publishing -- account-scoped publication intents and per-account
-- publish jobs (Issue #1145, ADR-0157, ADR-0148 capability C3).
--
-- ## The shape, and what it refuses to be
--
-- One logical PUBLICATION (the intent, `awcms_social_publications`) with an
-- immutable CONTENT SNAPSHOT, and ONE JOB PER TARGET `channel_account`
-- (`awcms_social_publish_jobs`). A job names an account; it never holds a token,
-- a secret reference or anything a reader of the queue could use to speak for
-- the tenant. The dispatcher resolves the credential for that account at
-- dispatch time, in memory, through the dispatcher-only credential port.
--
-- Three properties are enforced here rather than in application code, because
-- application code is what a later change forgets:
--
--   1. The snapshot is immutable. Editing or unpublishing the source article
--      cannot change what a queued job sends, and no UPDATE can rewrite a
--      caption, a link or a media snapshot (trigger).
--   2. `published` is TERMINAL. A job that reached the provider can never be
--      claimed, retried or rewritten: partial failure of a sibling cannot
--      replay it (trigger).
--   3. Idempotency is a UNIQUE KEY, not a convention: one intent per
--      (article, trigger) and one job per (intent, account), plus a tenant-wide
--      idempotency key hashed over tenant, source, trigger and account.
--
-- The publication's AGGREGATE status (queued, partially_published, published,
-- failed, cancelled) is derived from its jobs when read, never stored, so it
-- cannot drift from them.
--
-- ## RLS / GRANT
--
-- Every table is ENABLE + FORCE ROW LEVEL SECURITY with the standard
-- tenant_isolation policy (USING and WITH CHECK). awcms_app may not DELETE or
-- TRUNCATE a publication, a job or an attempt (they are evidence of what was
-- published and why). awcms_worker enqueues for the scheduled-publish job and
-- runs the dispatcher; it never decrypts anything here (there is nothing to
-- decrypt: the credential lives in channel_accounts).
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

CREATE TABLE IF NOT EXISTS awcms_social_publishing_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  -- Off until a tenant opts in: enabling the deployment flag alone never
  -- publishes anything.
  auto_publish_enabled boolean NOT NULL DEFAULT false,
  -- On by default: a tenant must choose to let articles reach public social
  -- accounts without a person approving each one.
  approval_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT awcms_social_publishing_settings_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_social_publishing_settings_updated_by_idx
  ON awcms_social_publishing_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

ALTER TABLE awcms_social_publishing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_social_publishing_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_social_publishing_settings_tenant_isolation
  ON awcms_social_publishing_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_social_publishing_settings FROM awcms_app;
REVOKE ALL ON awcms_social_publishing_settings FROM awcms_worker;
GRANT SELECT ON awcms_social_publishing_settings TO awcms_worker;

COMMENT ON TABLE awcms_social_publishing_settings IS
  'Issue #1145 / ADR-0157 -- per-tenant switches of social publishing. auto_publish_enabled defaults to false and approval_required to true, so the deployment flag alone publishes nothing.';

-- Which accounts an article event publishes to. A rule is a pointer to an
-- account the tenant already owns; it grants no capability (the account's
-- `publish` capability row does, and is re-checked at enqueue and at dispatch).
CREATE TABLE IF NOT EXISTS awcms_social_publish_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  trigger_event text NOT NULL,
  channel_account_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_social_publish_rules_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_social_publish_rules_account_trigger_key
    UNIQUE (tenant_id, trigger_event, channel_account_id),
  CONSTRAINT awcms_social_publish_rules_account_fk
    FOREIGN KEY (tenant_id, channel_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_social_publish_rules_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publish_rules_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publish_rules_trigger_check
    CHECK (trigger_event IN (
      'post_published', 'scheduled_published', 'manual_editor_action'
    ))
);

CREATE INDEX IF NOT EXISTS awcms_social_publish_rules_trigger_idx
  ON awcms_social_publish_rules (tenant_id, trigger_event)
  WHERE enabled;

CREATE INDEX IF NOT EXISTS awcms_social_publish_rules_account_idx
  ON awcms_social_publish_rules (tenant_id, channel_account_id);

CREATE INDEX IF NOT EXISTS awcms_social_publish_rules_created_by_idx
  ON awcms_social_publish_rules (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_social_publish_rules_updated_by_idx
  ON awcms_social_publish_rules (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

ALTER TABLE awcms_social_publish_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_social_publish_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_social_publish_rules_tenant_isolation
  ON awcms_social_publish_rules
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_social_publish_rules FROM awcms_app;
REVOKE ALL ON awcms_social_publish_rules FROM awcms_worker;
GRANT SELECT ON awcms_social_publish_rules TO awcms_worker;

COMMENT ON TABLE awcms_social_publish_rules IS
  'Issue #1145 / ADR-0157 -- an article event publishes to every ENABLED rule account of its trigger. Disabled, never deleted. A rule grants nothing: the account''s publish capability does.';

-- The intent: one logical publication with an immutable content snapshot.
CREATE TABLE IF NOT EXISTS awcms_social_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  source_kind text NOT NULL,
  -- The article id for an `article` source (blog_content owns it; no foreign
  -- key across the module boundary, and the snapshot makes none necessary).
  source_id uuid,
  trigger_event text NOT NULL,
  state text NOT NULL,
  refusal_code text,
  -- The CONTENT SNAPSHOT. Immutable (trigger below).
  title text NOT NULL,
  caption text NOT NULL,
  link_url text,
  media_object_id uuid,
  -- Verified public URL, MIME type, size, alt text, credit line and rights
  -- status exactly as media_library reported them at enqueue.
  media_snapshot jsonb,
  content_hash text NOT NULL,
  -- Dispatch is deferred until this instant (a schedule). NULL is "as soon as
  -- ready".
  not_before timestamptz,
  -- The tenant setting AT CREATION, so a later setting change cannot
  -- retroactively approve or un-approve a queued publication.
  approval_required boolean NOT NULL,
  correlation_id text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_social_publications_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_social_publications_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publications_approved_by_fk
    FOREIGN KEY (tenant_id, approved_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publications_cancelled_by_fk
    FOREIGN KEY (tenant_id, cancelled_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publications_source_kind_check
    CHECK (source_kind IN ('article', 'manual')),
  CONSTRAINT awcms_social_publications_source_id_check
    CHECK (source_kind <> 'article' OR source_id IS NOT NULL),
  CONSTRAINT awcms_social_publications_trigger_check
    CHECK (trigger_event IN (
      'post_published', 'scheduled_published', 'manual_editor_action'
    )),
  CONSTRAINT awcms_social_publications_state_check
    CHECK (state IN ('pending_approval', 'ready', 'cancelled', 'refused')),
  CONSTRAINT awcms_social_publications_title_check
    CHECK (btrim(title) <> '' AND char_length(title) <= 300),
  CONSTRAINT awcms_social_publications_caption_check
    CHECK (btrim(caption) <> '' AND char_length(caption) <= 2000),
  CONSTRAINT awcms_social_publications_link_url_check
    CHECK (
      link_url IS NULL
      OR (link_url ~ '^https://[^[:space:]@]+$' AND char_length(link_url) <= 2048)
    ),
  CONSTRAINT awcms_social_publications_content_hash_check
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_social_publications_media_snapshot_check
    CHECK (
      (media_object_id IS NULL) = (media_snapshot IS NULL)
      AND (media_snapshot IS NULL OR jsonb_typeof(media_snapshot) = 'object')
    ),
  CONSTRAINT awcms_social_publications_refusal_check
    CHECK ((state = 'refused') = (refusal_code IS NOT NULL)),
  CONSTRAINT awcms_social_publications_refusal_code_check
    CHECK (refusal_code IS NULL OR refusal_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  -- An approved publication says who and when; one that never needed approval,
  -- or is still waiting, does not.
  CONSTRAINT awcms_social_publications_approval_check
    CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  -- A publication that required approval is released by a person (L2 of the
  -- #1145 audit): the application path is not the only writer, so the database
  -- refuses a `ready` row of an approval-requiring publication with no approver.
  CONSTRAINT awcms_social_publications_ready_approved_check
    CHECK (state <> 'ready' OR NOT approval_required OR approved_by IS NOT NULL),
  -- Maker and checker: the person who composed a manual publication is not the
  -- one who approves it.
  CONSTRAINT awcms_social_publications_maker_checker_check
    CHECK (
      source_kind <> 'manual' OR approved_by IS NULL OR created_by IS NULL
      OR approved_by <> created_by
    ),
  CONSTRAINT awcms_social_publications_cancel_check
    CHECK (
      (state = 'cancelled') = (cancelled_at IS NOT NULL)
      AND (state = 'cancelled' OR (cancelled_by IS NULL AND cancel_reason IS NULL))
    ),
  CONSTRAINT awcms_social_publications_cancel_reason_check
    CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 300)
);

-- One intent per article event: a repeated publish event finds the same row.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_social_publications_article_dedup
  ON awcms_social_publications (tenant_id, source_id, trigger_event)
  WHERE source_kind = 'article';

-- The admin list, newest first (keyset on created_at, id).
CREATE INDEX IF NOT EXISTS awcms_social_publications_list_idx
  ON awcms_social_publications (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_social_publications_created_by_idx
  ON awcms_social_publications (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_social_publications_approved_by_idx
  ON awcms_social_publications (tenant_id, approved_by)
  WHERE approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_social_publications_cancelled_by_idx
  ON awcms_social_publications (tenant_id, cancelled_by)
  WHERE cancelled_by IS NOT NULL;

ALTER TABLE awcms_social_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_social_publications FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_social_publications_tenant_isolation
  ON awcms_social_publications
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_social_publications FROM awcms_app;
REVOKE ALL ON awcms_social_publications FROM awcms_worker;
-- The scheduled-publish worker enqueues (INSERT, and SELECT for the dedup read);
-- the dispatcher reads the snapshot. Neither updates a publication.
GRANT SELECT, INSERT ON awcms_social_publications TO awcms_worker;

COMMENT ON TABLE awcms_social_publications IS
  'Issue #1145 / ADR-0157 -- one logical publication with an IMMUTABLE content snapshot (trigger in this file). state is the approval/cancel lifecycle only; the aggregate publish status is derived from the jobs.';

-- One job per (publication, target account). No token, no secret reference.
CREATE TABLE IF NOT EXISTS awcms_social_publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  publication_id uuid NOT NULL,
  channel_account_id uuid NOT NULL,
  -- Snapshotted from the account at enqueue; immutable.
  provider text NOT NULL,
  account_kind text NOT NULL,
  -- The content shape chosen for this provider (never a downgrade: a variant
  -- the provider cannot take is a refusal at enqueue, not a different job).
  variant text NOT NULL,
  -- sha256 over tenant, source, trigger and account.
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  -- A job waiting for a recoverable account problem (degraded, expired grant)
  -- is HELD: it does not consume an attempt, but it does not wait forever.
  hold_count integer NOT NULL DEFAULT 0,
  -- While queued: when the job becomes due. While retry_wait: the backoff. While
  -- publishing: the CLAIM LEASE EXPIRY.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  external_post_id text,
  external_post_url text,
  failure_code text,
  -- Scrubbed by the dispatcher: a code-defined phrase, never a provider body.
  last_error text,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_social_publish_jobs_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_social_publish_jobs_idempotency_key_key
    UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT awcms_social_publish_jobs_publication_account_key
    UNIQUE (tenant_id, publication_id, channel_account_id),
  CONSTRAINT awcms_social_publish_jobs_publication_fk
    FOREIGN KEY (tenant_id, publication_id)
    REFERENCES awcms_social_publications (tenant_id, id),
  CONSTRAINT awcms_social_publish_jobs_account_fk
    FOREIGN KEY (tenant_id, channel_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_social_publish_jobs_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_social_publish_jobs_variant_check
    CHECK (variant IN ('text', 'image', 'video', 'short', 'story')),
  CONSTRAINT awcms_social_publish_jobs_status_check
    CHECK (status IN (
      'queued', 'publishing', 'retry_wait', 'published', 'failed', 'cancelled',
      'needs_reconciliation'
    )),
  CONSTRAINT awcms_social_publish_jobs_idempotency_key_check
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_social_publish_jobs_attempts_check
    CHECK (
      attempt_count >= 0 AND max_attempts BETWEEN 1 AND 50
      AND hold_count >= 0
    ),
  -- `published` carries the provider's identifiers and the instant, and nothing
  -- else does.
  CONSTRAINT awcms_social_publish_jobs_published_check
    CHECK (
      (status = 'published') = (published_at IS NOT NULL)
      AND (status = 'published') = (external_post_id IS NOT NULL)
    ),
  CONSTRAINT awcms_social_publish_jobs_external_post_id_check
    CHECK (external_post_id IS NULL OR char_length(external_post_id) BETWEEN 1 AND 255),
  CONSTRAINT awcms_social_publish_jobs_external_post_url_check
    CHECK (
      external_post_url IS NULL
      OR (external_post_url ~ '^https://[^[:space:]@]+$'
          AND char_length(external_post_url) <= 2048)
    ),
  CONSTRAINT awcms_social_publish_jobs_failure_code_check
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT awcms_social_publish_jobs_last_error_check
    CHECK (last_error IS NULL OR char_length(last_error) <= 300)
);

-- The dispatcher's claim predicate, in its column order.
CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_dispatch_idx
  ON awcms_social_publish_jobs (tenant_id, status, next_attempt_at)
  WHERE status IN ('queued', 'retry_wait', 'publishing');

-- The per-account daily cap counts recent publishes of ONE account.
CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_quota_idx
  ON awcms_social_publish_jobs (tenant_id, channel_account_id, published_at)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_publication_idx
  ON awcms_social_publish_jobs (tenant_id, publication_id);

CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_account_idx
  ON awcms_social_publish_jobs (tenant_id, channel_account_id);

CREATE INDEX IF NOT EXISTS awcms_social_publish_jobs_created_by_idx
  ON awcms_social_publish_jobs (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE awcms_social_publish_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_social_publish_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_social_publish_jobs_tenant_isolation
  ON awcms_social_publish_jobs
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_social_publish_jobs FROM awcms_app;
REVOKE ALL ON awcms_social_publish_jobs FROM awcms_worker;
GRANT SELECT, INSERT, UPDATE ON awcms_social_publish_jobs TO awcms_worker;
-- M4 of the #1145 audit: the enqueue path (the scheduled-publish worker) and the
-- dispatcher honour a tenant's decision to switch the module OFF, so they read
-- the module-enablement row. Enabled flags only, no credential, tenant RLS.
GRANT SELECT ON awcms_tenant_modules TO awcms_worker;

COMMENT ON TABLE awcms_social_publish_jobs IS
  'Issue #1145 / ADR-0157 -- one publish job per (publication, channel account). Names the account; holds no token and no secret reference. published is terminal (trigger in this file).';

-- Per-attempt ledger. Never a caption, a provider body or a credential.
CREATE TABLE IF NOT EXISTS awcms_social_publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  job_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  outcome text NOT NULL,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_social_publish_attempts_job_fk
    FOREIGN KEY (tenant_id, job_id)
    REFERENCES awcms_social_publish_jobs (tenant_id, id),
  CONSTRAINT awcms_social_publish_attempts_outcome_check
    CHECK (outcome IN (
      'published', 'retryable', 'rate_limited', 'needs_reauth', 'rejected',
      'account_unavailable', 'unknown'
    )),
  CONSTRAINT awcms_social_publish_attempts_error_code_check
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  CONSTRAINT awcms_social_publish_attempts_error_message_check
    CHECK (error_message IS NULL OR char_length(error_message) <= 300),
  -- An expired-lease re-claim recomputes the same attempt number; the call site
  -- uses ON CONFLICT DO NOTHING so a replay cannot abort a pass.
  CONSTRAINT awcms_social_publish_attempts_unique_attempt
    UNIQUE (job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS awcms_social_publish_attempts_job_idx
  ON awcms_social_publish_attempts (tenant_id, job_id);

ALTER TABLE awcms_social_publish_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_social_publish_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_social_publish_attempts_tenant_isolation
  ON awcms_social_publish_attempts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Append-only: an attempt is evidence of what the dispatcher did, so the runtime
-- role that serves the API can read and add one but never change or erase it.
REVOKE UPDATE, DELETE, TRUNCATE ON awcms_social_publish_attempts FROM awcms_app;
REVOKE ALL ON awcms_social_publish_attempts FROM awcms_worker;
GRANT SELECT, INSERT ON awcms_social_publish_attempts TO awcms_worker;

COMMENT ON TABLE awcms_social_publish_attempts IS
  'Issue #1145 / ADR-0157 -- append-only attempt ledger of the dispatcher: outcome, a code and a scrubbed phrase. No caption, no provider body, no credential.';

-- ---------------------------------------------------------------------------
-- Integrity guards
-- ---------------------------------------------------------------------------

-- The snapshot never changes, and the lifecycle is one-way.
CREATE OR REPLACE FUNCTION awcms_social_publications_snapshot_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
     OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.trigger_event IS DISTINCT FROM OLD.trigger_event
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.caption IS DISTINCT FROM OLD.caption
     OR NEW.link_url IS DISTINCT FROM OLD.link_url
     OR NEW.media_object_id IS DISTINCT FROM OLD.media_object_id
     OR NEW.media_snapshot IS DISTINCT FROM OLD.media_snapshot
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.approval_required IS DISTINCT FROM OLD.approval_required
     OR NEW.refusal_code IS DISTINCT FROM OLD.refusal_code
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a social publication content snapshot and identity are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state IN ('cancelled', 'refused') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'a cancelled or refused social publication is terminal'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state = 'ready' AND NEW.state NOT IN ('ready', 'cancelled') THEN
    RAISE EXCEPTION 'a ready social publication can only be cancelled'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state IN ('cancelled', 'refused')
     AND (NEW.not_before IS DISTINCT FROM OLD.not_before
          OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
          OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
          OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
          OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
          OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'a cancelled or refused social publication is terminal'
      USING ERRCODE = '23514';
  END IF;

  -- Approval is recorded once and never rewritten.
  IF OLD.approved_at IS NOT NULL
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
          OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'a social publication approval is recorded once'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_social_publications_snapshot_guard
  BEFORE UPDATE ON awcms_social_publications
  FOR EACH ROW
  EXECUTE FUNCTION awcms_social_publications_snapshot_guard();

-- A job's identity never changes; `published` and `cancelled` are terminal; and
-- the only ways out of `failed` are a deliberate retry back to `queued`.
CREATE OR REPLACE FUNCTION awcms_social_publish_jobs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
     OR NEW.channel_account_id IS DISTINCT FROM OLD.channel_account_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.account_kind IS DISTINCT FROM OLD.account_kind
     OR NEW.variant IS DISTINCT FROM OLD.variant
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a social publish job identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status IN ('published', 'cancelled') THEN
    -- Terminal: nothing about the job may change, including by a replayed
    -- dispatcher pass that still holds a stale copy.
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.attempt_count IS DISTINCT FROM OLD.attempt_count
       OR NEW.external_post_id IS DISTINCT FROM OLD.external_post_id
       OR NEW.external_post_url IS DISTINCT FROM OLD.external_post_url
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.failure_code IS DISTINCT FROM OLD.failure_code
       OR NEW.last_error IS DISTINCT FROM OLD.last_error
       OR NEW.next_attempt_at IS DISTINCT FROM OLD.next_attempt_at THEN
      RAISE EXCEPTION 'a published or cancelled social publish job is terminal'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- A job whose outcome is UNKNOWN (the request may have reached the provider
  -- and published) is never retried by the dispatcher: it leaves this status
  -- only by an operator's confirmed retry (back to queued) or by cancel.
  IF OLD.status = 'needs_reconciliation'
     AND NEW.status NOT IN ('needs_reconciliation', 'queued', 'cancelled') THEN
    RAISE EXCEPTION 'a social publish job with an unknown outcome needs an operator'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'failed' AND NEW.status NOT IN ('failed', 'queued') THEN
    RAISE EXCEPTION 'a failed social publish job can only be retried to queued'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'publishing', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'a queued social publish job cannot move to that status'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'retry_wait'
     AND NEW.status NOT IN ('retry_wait', 'publishing', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'a waiting social publish job cannot move to that status'
      USING ERRCODE = '23514';
  END IF;

  -- The attempt counter only goes up (a retry resets nothing it has recorded).
  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'a social publish job attempt count never decreases'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_social_publish_jobs_guard
  BEFORE UPDATE ON awcms_social_publish_jobs
  FOR EACH ROW
  EXECUTE FUNCTION awcms_social_publish_jobs_guard();

-- A job may only be created for a publication of its OWN tenant that is not
-- already cancelled or refused, and for an account that is live. (The composite
-- foreign keys prove same-tenant existence; they cannot see state.)
CREATE OR REPLACE FUNCTION awcms_social_publish_jobs_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.status <> 'queued' OR NEW.attempt_count <> 0 THEN
    RAISE EXCEPTION 'a social publish job is created queued with no attempts'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM awcms_social_publications
    WHERE tenant_id = NEW.tenant_id AND id = NEW.publication_id
      AND state IN ('pending_approval', 'ready')
  ) THEN
    RAISE EXCEPTION 'a social publish job needs a live publication of its own tenant'
      USING ERRCODE = '23514';
  END IF;

  -- A publication that was approved was approved for the targets it HAD (L3 of
  -- the #1145 audit): a new target needs a new publication, and therefore a new
  -- approval, not a quiet addition to an approved one.
  IF EXISTS (
    SELECT 1 FROM awcms_social_publications
    WHERE tenant_id = NEW.tenant_id AND id = NEW.publication_id
      AND approval_required AND approved_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'an approved social publication cannot gain a target'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM awcms_channel_accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.channel_account_id
      AND deleted_at IS NULL
      AND status = 'connected'
  ) THEN
    RAISE EXCEPTION 'a social publish job needs a connected account of its own tenant'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_social_publish_jobs_insert_guard
  BEFORE INSERT ON awcms_social_publish_jobs
  FOR EACH ROW
  EXECUTE FUNCTION awcms_social_publish_jobs_insert_guard();
