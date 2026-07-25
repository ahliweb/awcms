-- ADR-0041 (ported from awcms-micro Issue #271, epic #261 Wave 2) — first runtime
-- schema of the `comments` module: tenant-scoped, MODERATION-FIRST commenting
-- over PUBLISHED, PUBLIC commentable resources (blog posts today; any module's
-- `CommentableResourceDescriptor` tomorrow).
--
-- ## Moderation-first, privacy-minimized by construction (ADR-0041 threat model)
--
-- A comment is NEVER shown publicly unless `status = 'approved'`. The public list
-- query filters on exactly that; moderation metadata (reason codes, actor,
-- ip/email hashes, internal ids) never leaves the admin surface. Author contact
-- data is stored MINIMIZED: never a raw email — only a sha256 lookup hash
-- (`author_email_hash`) plus a display mask (`author_email_masked`, e.g.
-- `j***@e***`). IP/user-agent are hashed (`author_ip_hash`/`user_agent_hash`) for
-- abuse correlation only. Reply-notify recipient addresses live ONLY in
-- `awcms_comments_reply_subscriptions`, AES-256-GCM encrypted, and are NEVER
-- exposed in any API response, event, or log.
--
-- ## Publication-state is enforced at the resource->thread boundary, NOT here
--
-- A thread is only opened for a resource the comments engine has confirmed is
-- PUBLISHED & PUBLIC via the owning module's declarative
-- `CommentableResourcePublicationFilter` (re-validated identifiers, bound filter
-- VALUES). This schema stores the thread's resolved policy + counters; it is
-- never itself an authorization source for the underlying resource.
--
-- ## Append-only history
--
-- `awcms_comments_moderation_events` is append-only moderation history and
-- `awcms_comments_reports` an abuse-report ledger — neither is ever mutated to
-- rewrite the past (only reports transition open->reviewed/dismissed via their
-- own status column). Comments themselves soft-delete (status `deleted`, row
-- retained) so history stays coherent; retention/anonymization is a bounded sweep
-- (`bun run comments:retention`) that honors legal hold.

-- ---------------------------------------------------------------------------
-- 1. Threads — one per (commentable resource, locale)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_comments_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- The contributing `CommentableResourceDescriptor.resourceType` (e.g. `blog_post`).
  resource_type text NOT NULL,
  -- The source row's primary key (stored as text — resource ids are generic).
  resource_id text NOT NULL,
  locale text NOT NULL,
  -- Server-derived public path for the resource (built from the descriptor's
  -- urlTemplate, with :tenantCode/:slug/:id URL-encoded) — never a raw
  -- tenant-supplied URL.
  url text NOT NULL,
  policy_mode text NOT NULL DEFAULT 'moderated-anonymous',
  is_closed boolean NOT NULL DEFAULT false,
  comment_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_comments_threads_policy_check
    CHECK (policy_mode IN ('disabled', 'authenticated-only', 'moderated-anonymous', 'moderated-registered')),
  CONSTRAINT awcms_comments_threads_url_len
    CHECK (char_length(url) <= 2048),
  CONSTRAINT awcms_comments_threads_counts_nonneg
    CHECK (comment_count >= 0 AND approved_count >= 0 AND approved_count <= comment_count)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_comments_threads_resource_dedup
  ON awcms_comments_threads (tenant_id, resource_type, resource_id, locale);

ALTER TABLE awcms_comments_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_threads FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_threads_tenant_isolation
  ON awcms_comments_threads
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 2. Comments — bounded-depth, moderation-gated, privacy-minimized
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_comments_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  thread_id uuid NOT NULL REFERENCES awcms_comments_threads (id),
  -- Self-FK for bounded-depth replies (NULL = top-level).
  parent_id uuid REFERENCES awcms_comments_comments (id),
  -- Depth is bounded: reject unbounded recursion (0..4). max_depth in settings
  -- may tighten this further, never loosen past this hard cap.
  depth integer NOT NULL DEFAULT 0,
  -- Raw plain text ONLY — never stored HTML. Rendering escapes everything.
  body_text text NOT NULL,
  body_format text NOT NULL DEFAULT 'plain',
  status text NOT NULL DEFAULT 'pending',
  author_kind text NOT NULL DEFAULT 'anonymous',
  -- Nullable uuid reference for a registered author (tenant_user). Not a hard FK:
  -- a registered author's account can be removed without cascading-deleting their
  -- (soft-deletable, retained) comment history.
  author_user_id uuid,
  author_display_name text,
  -- sha256 lookup hash of the normalized email — NEVER the raw address.
  author_email_hash text,
  -- Display mask only, e.g. `j***@e***` — safe to render to moderators.
  author_email_masked text,
  -- Hashed abuse-correlation signals only (never raw IP / UA).
  author_ip_hash text,
  user_agent_hash text,
  -- Author may edit until this deadline (edit-within-window).
  edit_deadline_at timestamptz,
  edited_at timestamptz,
  -- Moderation reason code (nullable) — admin-only, never rendered publicly.
  moderation_reason_code text,
  -- sha256 fingerprint of normalized body+author within a window (duplicate/spam).
  content_fingerprint text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_comments_comments_depth_range
    CHECK (depth BETWEEN 0 AND 4),
  CONSTRAINT awcms_comments_comments_body_len
    CHECK (char_length(body_text) >= 1 AND char_length(body_text) <= 4000),
  CONSTRAINT awcms_comments_comments_body_format_check
    CHECK (body_format = 'plain'),
  CONSTRAINT awcms_comments_comments_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'spam', 'deleted')),
  CONSTRAINT awcms_comments_comments_author_kind_check
    CHECK (author_kind IN ('anonymous', 'registered')),
  CONSTRAINT awcms_comments_comments_display_name_len
    CHECK (author_display_name IS NULL OR char_length(author_display_name) <= 120),
  CONSTRAINT awcms_comments_comments_reason_len
    CHECK (moderation_reason_code IS NULL OR char_length(moderation_reason_code) <= 64),
  -- A registered author must carry a user id; an anonymous author must not.
  CONSTRAINT awcms_comments_comments_registered_user
    CHECK (
      (author_kind = 'registered' AND author_user_id IS NOT NULL) OR
      (author_kind = 'anonymous' AND author_user_id IS NULL)
    )
);

-- Public list path: approved, per-thread, chronological.
CREATE INDEX IF NOT EXISTS awcms_comments_comments_thread_status_created_idx
  ON awcms_comments_comments (tenant_id, thread_id, status, created_at);

-- Admin moderation queue path (status + keyset).
CREATE INDEX IF NOT EXISTS awcms_comments_comments_status_created_idx
  ON awcms_comments_comments (tenant_id, status, created_at);

-- Reply-tree walk.
CREATE INDEX IF NOT EXISTS awcms_comments_comments_parent_idx
  ON awcms_comments_comments (tenant_id, parent_id);

-- Duplicate/abuse correlation by author email hash.
CREATE INDEX IF NOT EXISTS awcms_comments_comments_email_hash_idx
  ON awcms_comments_comments (tenant_id, author_email_hash);

-- Duplicate-submission fingerprint lookup within the recency window.
CREATE INDEX IF NOT EXISTS awcms_comments_comments_fingerprint_idx
  ON awcms_comments_comments (tenant_id, content_fingerprint, created_at);

-- The retention sweep's own cursor: it walks aged, not-yet-anonymized rows.
CREATE INDEX IF NOT EXISTS awcms_comments_comments_tenant_created_idx
  ON awcms_comments_comments (tenant_id, created_at);

ALTER TABLE awcms_comments_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_comments FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_comments_tenant_isolation
  ON awcms_comments_comments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 3. Moderation events — append-only history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_comments_moderation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  comment_id uuid NOT NULL REFERENCES awcms_comments_comments (id),
  action text NOT NULL,
  reason_code text,
  actor_user_id uuid,
  actor_kind text NOT NULL DEFAULT 'moderator',
  -- Sanitized free-text note only (never a raw stack trace / secret).
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_comments_moderation_events_action_check
    CHECK (action IN ('approve', 'reject', 'spam', 'archive', 'restore', 'delete', 'edit', 'anonymize')),
  CONSTRAINT awcms_comments_moderation_events_actor_kind_check
    CHECK (actor_kind IN ('moderator', 'system', 'author')),
  CONSTRAINT awcms_comments_moderation_events_reason_len
    CHECK (reason_code IS NULL OR char_length(reason_code) <= 64),
  CONSTRAINT awcms_comments_moderation_events_note_len
    CHECK (note IS NULL OR char_length(note) <= 2000)
);

CREATE INDEX IF NOT EXISTS awcms_comments_moderation_events_comment_idx
  ON awcms_comments_moderation_events (tenant_id, comment_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_comments_moderation_events_tenant_created_idx
  ON awcms_comments_moderation_events (tenant_id, created_at);

ALTER TABLE awcms_comments_moderation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_moderation_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_moderation_events_tenant_isolation
  ON awcms_comments_moderation_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 4. Reports — abuse flags (dedup-bounded)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_comments_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  comment_id uuid NOT NULL REFERENCES awcms_comments_comments (id),
  reporter_email_hash text,
  reporter_ip_hash text NOT NULL,
  reason_code text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_comments_reports_reason_check
    CHECK (reason_code IN ('spam', 'abuse', 'offensive', 'other')),
  CONSTRAINT awcms_comments_reports_status_check
    CHECK (status IN ('open', 'reviewed', 'dismissed')),
  CONSTRAINT awcms_comments_reports_detail_len
    CHECK (detail IS NULL OR char_length(detail) <= 1000)
);

-- Bound report floods: one flag per (comment, reporter ip, reason).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_comments_reports_dedup
  ON awcms_comments_reports (tenant_id, comment_id, reporter_ip_hash, reason_code);

CREATE INDEX IF NOT EXISTS awcms_comments_reports_status_created_idx
  ON awcms_comments_reports (tenant_id, status, created_at);

ALTER TABLE awcms_comments_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_reports FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_reports_tenant_isolation
  ON awcms_comments_reports
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 5. Reply subscriptions — email reply-notify opt-ins (minimized, double-opt-in)
-- ---------------------------------------------------------------------------
-- The recipient address is NEVER exposed in any API/response/log. This table
-- stores only what the email outbox needs: a sha256 lookup hash, an AES-256-GCM
-- encrypted address the dispatcher resolves at send time, and an unsubscribe
-- token hash. Registered as a data_lifecycle high-volume table (comments/module.ts).
CREATE TABLE IF NOT EXISTS awcms_comments_reply_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  thread_id uuid NOT NULL REFERENCES awcms_comments_threads (id),
  -- The comment being subscribed to (NULL = whole thread).
  comment_id uuid REFERENCES awcms_comments_comments (id),
  subscriber_email_hash text NOT NULL,
  -- Minimized recipient reference — AES-256-GCM ciphertext, or the literal
  -- `unresolvable` sentinel when no key is configured. Never a plaintext
  -- address. Only the email dispatcher resolves it, at send time.
  subscriber_email_encrypted text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  unsubscribe_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT awcms_comments_reply_subscriptions_hash_len
    CHECK (char_length(subscriber_email_hash) <= 128)
);

-- One subscription per (thread/comment scope, subscriber).
CREATE UNIQUE INDEX IF NOT EXISTS awcms_comments_reply_subscriptions_dedup
  ON awcms_comments_reply_subscriptions
     (tenant_id, thread_id, coalesce(comment_id, '00000000-0000-0000-0000-000000000000'::uuid), subscriber_email_hash);

CREATE INDEX IF NOT EXISTS awcms_comments_reply_subscriptions_comment_idx
  ON awcms_comments_reply_subscriptions (tenant_id, comment_id);

CREATE INDEX IF NOT EXISTS awcms_comments_reply_subscriptions_created_idx
  ON awcms_comments_reply_subscriptions (tenant_id, created_at);

ALTER TABLE awcms_comments_reply_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_reply_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_reply_subscriptions_tenant_isolation
  ON awcms_comments_reply_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 6. Settings — per-tenant config (one row per tenant, upsert-shaped)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_comments_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  default_policy_mode text NOT NULL DEFAULT 'moderated-anonymous',
  require_moderation boolean NOT NULL DEFAULT true,
  allow_anonymous boolean NOT NULL DEFAULT true,
  edit_window_seconds integer NOT NULL DEFAULT 300,
  max_depth integer NOT NULL DEFAULT 3,
  max_length integer NOT NULL DEFAULT 4000,
  max_links_per_comment integer NOT NULL DEFAULT 2,
  min_submit_seconds integer NOT NULL DEFAULT 3,
  rate_limit_per_hour integer NOT NULL DEFAULT 10,
  blocked_terms text[] NOT NULL DEFAULT '{}',
  turnstile_enabled boolean NOT NULL DEFAULT false,
  notify_on_reply boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT awcms_comments_settings_policy_check
    CHECK (default_policy_mode IN ('disabled', 'authenticated-only', 'moderated-anonymous', 'moderated-registered')),
  CONSTRAINT awcms_comments_settings_edit_window_range
    CHECK (edit_window_seconds BETWEEN 0 AND 86400),
  CONSTRAINT awcms_comments_settings_max_depth_range
    CHECK (max_depth BETWEEN 0 AND 8),
  CONSTRAINT awcms_comments_settings_max_length_range
    CHECK (max_length BETWEEN 100 AND 4000),
  CONSTRAINT awcms_comments_settings_max_links_range
    CHECK (max_links_per_comment BETWEEN 0 AND 20),
  CONSTRAINT awcms_comments_settings_min_submit_range
    CHECK (min_submit_seconds BETWEEN 0 AND 600),
  CONSTRAINT awcms_comments_settings_rate_limit_range
    CHECK (rate_limit_per_hour BETWEEN 1 AND 1000),
  CONSTRAINT awcms_comments_settings_blocked_terms_bound
    CHECK (array_length(blocked_terms, 1) IS NULL OR array_length(blocked_terms, 1) <= 200)
);

ALTER TABLE awcms_comments_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_settings_tenant_isolation
  ON awcms_comments_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- 7. Abuse events — minimized anti-abuse telemetry (generic purge)
-- ---------------------------------------------------------------------------
-- Privacy-minimized (hashes + reason only). Registered as a `generic`-execution
-- high-volume descriptor in comments/module.ts, so the data_lifecycle purge
-- engine (worker role) needs SELECT + DELETE.
CREATE TABLE IF NOT EXISTS awcms_comments_abuse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  ip_hash text,
  fingerprint_hash text,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_comments_abuse_events_reason_len
    CHECK (char_length(reason) <= 64)
);

CREATE INDEX IF NOT EXISTS awcms_comments_abuse_events_tenant_occurred_idx
  ON awcms_comments_abuse_events (tenant_id, occurred_at);

ALTER TABLE awcms_comments_abuse_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_comments_abuse_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_comments_abuse_events_tenant_isolation
  ON awcms_comments_abuse_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege `awcms_worker` grants
-- ---------------------------------------------------------------------------
-- `awcms_app` gets its table privileges from the blanket grant in migration 019;
-- RLS FORCE above is what actually confines it to one tenant.
--
-- The worker role runs (a) `comments:retention` — the bounded per-tenant sweep
-- that UPDATEs comments to anonymize aged author identity, appends an
-- `anonymize` moderation event, DELETEs expired unconfirmed reply subscriptions,
-- and reads settings/threads; and (b) the data_lifecycle GENERIC purge engine
-- over `awcms_comments_abuse_events` + `awcms_comments_reply_subscriptions`,
-- which needs SELECT + DELETE (same pattern as `awcms_site_search_query_log`,
-- migration 064). NO INSERT on comments: the worker never authors one. NO DELETE
-- on comments either — retention ANONYMIZES in place so the append-only history
-- stays coherent. RLS FORCE still applies to the worker, so every
-- withTenant-scoped pass sees only its own tenant.
GRANT SELECT ON awcms_comments_settings TO awcms_worker;
GRANT SELECT ON awcms_comments_threads TO awcms_worker;
GRANT SELECT, UPDATE ON awcms_comments_comments TO awcms_worker;
GRANT SELECT, INSERT ON awcms_comments_moderation_events TO awcms_worker;
GRANT SELECT, DELETE ON awcms_comments_abuse_events TO awcms_worker;
GRANT SELECT, DELETE ON awcms_comments_reply_subscriptions TO awcms_worker;
