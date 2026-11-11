-- `omnichannel_inbox` -- a rebuildable, body-free staff work projection over
-- verified inbound envelopes (Issue #1164, ADR-0160 `Proposed`; refines
-- ADR-0150 section 1 for staff work state only).
--
-- ## What these tables hold, and what they never hold
--
-- A conversation row is keyed by (source kind, OPAQUE source reference): the
-- account-scoped Telegram contact id of `awcms.telegram_engagement.*` or the
-- submission id of `awcms.website_engagement.*`. Those ids are what the
-- envelopes carry; neither is a Telegram id, a chat id, a phone number, an
-- e-mail address or a name. There is NO column for a message body, a
-- `content_ref`, a sender address, media or free text about a customer
-- (ADR-0150 N4/N6 as refined by ADR-0160 section 2).
--
-- Two kinds of column live side by side and are kept apart on purpose:
--
--   * PROJECTED (written only by the domain-event consumer, idempotent by
--     value, rebuildable from `awcms_domain_events`): channel account, business
--     scope, first/last inbound time, awaiting-since, customer state and the
--     event sequence of the last customer-state change.
--   * AUTHORED staff work state (written by people through the API, never
--     rebuilt): status, assignee, first/last response, `answered_through`, SLA
--     due/breach stamps. The projector may REOPEN a resolved/closed
--     conversation and start an SLA clock, but only for an envelope received
--     after `answered_through`.
--
-- The activity ledger is append-only for the runtime role (UPDATE and DELETE
-- revoked below); it goes with its conversation when retention purges the
-- conversation (ON DELETE CASCADE, run by the referential trigger, not by
-- awcms_app).
--
-- Every table is tenant-scoped with ENABLE + FORCE ROW LEVEL SECURITY and a
-- tenant-isolation policy (ADR-0148 I1).

-- ---------------------------------------------------------------------------
-- SLA policies: per tenant, optionally per business scope (a brand).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_inbox_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Both NULL = the tenant default policy.
  business_scope_type text,
  business_scope_id uuid,
  name text NOT NULL,
  -- IANA zone name; validated by the application (Intl) before it is written.
  timezone text NOT NULL,
  first_response_minutes integer NOT NULL,
  next_response_minutes integer NOT NULL,
  -- Seven entries, ISO weekday 1 (Monday) .. 7 (Sunday): either null (closed)
  -- or {"start": <minute of day>, "end": <minute of day>}. Shape-checked by the
  -- application; bounded in size here.
  working_hours jsonb NOT NULL,
  -- Local calendar dates (in `timezone`) that are not working days.
  holidays date[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active',
  retired_at timestamptz,
  created_by uuid,
  retired_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inbox_sla_policies_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inbox_sla_policies_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (
      business_scope_type IS NOT NULL
      AND business_scope_id IS NOT NULL
      AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT awcms_inbox_sla_policies_name_check
    CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT awcms_inbox_sla_policies_timezone_check
    CHECK (char_length(timezone) BETWEEN 1 AND 64 AND timezone ~ '^[A-Za-z0-9_+\-/]+$'),
  CONSTRAINT awcms_inbox_sla_policies_first_minutes_check
    CHECK (first_response_minutes BETWEEN 1 AND 43200),
  CONSTRAINT awcms_inbox_sla_policies_next_minutes_check
    CHECK (next_response_minutes BETWEEN 1 AND 43200),
  CONSTRAINT awcms_inbox_sla_policies_working_hours_check
    CHECK (jsonb_typeof(working_hours) = 'array' AND jsonb_array_length(working_hours) = 7),
  CONSTRAINT awcms_inbox_sla_policies_holidays_bounded
    CHECK (cardinality(holidays) <= 366),
  CONSTRAINT awcms_inbox_sla_policies_status_check
    CHECK (status IN ('active', 'retired')),
  CONSTRAINT awcms_inbox_sla_policies_retired_pair_check
    CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT awcms_inbox_sla_policies_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inbox_sla_policies_retired_by_fk
    FOREIGN KEY (tenant_id, retired_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

-- At most one ACTIVE policy per (tenant, scope); the tenant default is the
-- scope-less one. COALESCE folds NULL so two tenant defaults collide too.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_inbox_sla_policies_active_scope_key
  ON awcms_inbox_sla_policies (
    tenant_id,
    COALESCE(business_scope_type, ''),
    COALESCE(business_scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS awcms_inbox_sla_policies_list_idx
  ON awcms_inbox_sla_policies (tenant_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS awcms_inbox_sla_policies_created_by_idx
  ON awcms_inbox_sla_policies (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_sla_policies_retired_by_idx
  ON awcms_inbox_sla_policies (tenant_id, retired_by)
  WHERE retired_by IS NOT NULL;

COMMENT ON TABLE awcms_inbox_sla_policies IS
  'Issue #1164 / ADR-0160 section 4 -- first/next response budgets in business minutes on a working calendar (IANA zone, weekday hours, holidays), per tenant or per business scope. Authored by an administrator; retired, never deleted.';

ALTER TABLE awcms_inbox_sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inbox_sla_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inbox_sla_policies_tenant_isolation
  ON awcms_inbox_sla_policies
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_inbox_sla_policies FROM awcms_app;
REVOKE ALL ON awcms_inbox_sla_policies FROM awcms_worker;
-- The data_lifecycle dry-run snapshot counts by (tenant, cursor) only.
GRANT SELECT (id, tenant_id, created_at) ON awcms_inbox_sla_policies TO awcms_worker;

-- ---------------------------------------------------------------------------
-- Conversations: the projection plus the authored staff work state.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_inbox_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- PROJECTED ----------------------------------------------------------------
  source_kind text NOT NULL,
  -- The envelope's opaque reference: the account-scoped Telegram contact id or
  -- the website submission id. Never an external identifier.
  source_ref uuid NOT NULL,
  channel_account_id uuid,
  -- The channel account's business scope (a brand) at the latest projection;
  -- both NULL = tenant-wide (every website submission, a tenant-wide account).
  business_scope_type text,
  business_scope_id uuid,
  first_inbound_at timestamptz NOT NULL,
  last_inbound_at timestamptz NOT NULL,
  -- The receipt time of the first inbound not yet answered; NULL = nothing owed.
  awaiting_since timestamptz,
  customer_state text NOT NULL DEFAULT 'active',
  -- `event_sequence` of the event that set `customer_state` (monotonic, so a
  -- redelivered or replayed older event can never undo a newer withdrawal).
  customer_state_sequence bigint NOT NULL DEFAULT 0,
  -- AUTHORED -----------------------------------------------------------------
  status text NOT NULL DEFAULT 'open',
  assignee_tenant_user_id uuid,
  assigned_at timestamptz,
  first_responded_at timestamptz,
  last_responded_at timestamptz,
  -- Everything received up to this instant is settled: the latest recorded
  -- response, or the moment staff resolved/closed the conversation. An inbound
  -- envelope counts as unanswered only if it was received AFTER it, so a
  -- redelivered or replayed older event never reopens settled work.
  answered_through timestamptz,
  sla_policy_id uuid,
  response_due_kind text,
  response_due_at timestamptz,
  sla_breached_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inbox_conversations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inbox_conversations_source_key
    UNIQUE (tenant_id, source_kind, source_ref),
  CONSTRAINT awcms_inbox_conversations_source_kind_check
    CHECK (source_kind IN ('telegram', 'website')),
  -- A Telegram conversation belongs to exactly one bot account; a website
  -- submission to none.
  CONSTRAINT awcms_inbox_conversations_account_shape_check CHECK (
    (source_kind = 'telegram' AND channel_account_id IS NOT NULL)
    OR (source_kind = 'website' AND channel_account_id IS NULL)
  ),
  CONSTRAINT awcms_inbox_conversations_scope_pair_check CHECK (
    (business_scope_type IS NULL AND business_scope_id IS NULL)
    OR (
      business_scope_type IS NOT NULL
      AND business_scope_id IS NOT NULL
      AND business_scope_type ~ '^[a-z][a-z0-9_]*$'
    )
  ),
  CONSTRAINT awcms_inbox_conversations_inbound_order_check
    CHECK (first_inbound_at <= last_inbound_at),
  CONSTRAINT awcms_inbox_conversations_customer_state_check
    CHECK (customer_state IN ('active', 'opted_out', 'withdrawn')),
  CONSTRAINT awcms_inbox_conversations_status_check
    CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
  CONSTRAINT awcms_inbox_conversations_assignee_pair_check
    CHECK ((assignee_tenant_user_id IS NULL) = (assigned_at IS NULL)),
  CONSTRAINT awcms_inbox_conversations_due_kind_check
    CHECK (response_due_kind IS NULL OR response_due_kind IN ('first', 'next')),
  CONSTRAINT awcms_inbox_conversations_due_pair_check
    CHECK ((response_due_kind IS NULL) = (response_due_at IS NULL)),
  -- Nothing is owed while nothing is awaited.
  CONSTRAINT awcms_inbox_conversations_due_needs_wait_check
    CHECK (response_due_at IS NULL OR awaiting_since IS NOT NULL),
  CONSTRAINT awcms_inbox_conversations_version_check CHECK (version >= 1),
  CONSTRAINT awcms_inbox_conversations_account_fk
    FOREIGN KEY (tenant_id, channel_account_id)
    REFERENCES awcms_channel_accounts (tenant_id, id),
  CONSTRAINT awcms_inbox_conversations_assignee_fk
    FOREIGN KEY (tenant_id, assignee_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inbox_conversations_sla_policy_fk
    FOREIGN KEY (tenant_id, sla_policy_id)
    REFERENCES awcms_inbox_sla_policies (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_list_idx
  ON awcms_inbox_conversations (tenant_id, last_inbound_at DESC, id DESC);

-- The data_lifecycle generic purge filters and orders by (tenant, cursor).
CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_retention_idx
  ON awcms_inbox_conversations (tenant_id, last_inbound_at);

CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_account_idx
  ON awcms_inbox_conversations (tenant_id, channel_account_id)
  WHERE channel_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_scope_idx
  ON awcms_inbox_conversations (tenant_id, business_scope_type, business_scope_id)
  WHERE business_scope_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_assignee_idx
  ON awcms_inbox_conversations (tenant_id, assignee_tenant_user_id)
  WHERE assignee_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_sla_policy_idx
  ON awcms_inbox_conversations (tenant_id, sla_policy_id)
  WHERE sla_policy_id IS NOT NULL;

-- The SLA job's scan: what is owed, unbreached, by due time.
CREATE INDEX IF NOT EXISTS awcms_inbox_conversations_due_idx
  ON awcms_inbox_conversations (tenant_id, response_due_at)
  WHERE response_due_at IS NOT NULL AND sla_breached_at IS NULL;

COMMENT ON TABLE awcms_inbox_conversations IS
  'Issue #1164 / ADR-0160 -- one row per (source kind, opaque envelope reference): projected inbound facts (rebuildable from awcms_domain_events) and authored staff work state (status, assignee, responses, SLA). No message body, sender address or external id. Purged by data_lifecycle on last_inbound_at.';

ALTER TABLE awcms_inbox_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inbox_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inbox_conversations_tenant_isolation
  ON awcms_inbox_conversations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The runtime never deletes a conversation (the retention job does); the
-- worker sees only the key, the tenant and the cursor.
REVOKE DELETE, TRUNCATE ON awcms_inbox_conversations FROM awcms_app;
REVOKE ALL ON awcms_inbox_conversations FROM awcms_worker;
GRANT SELECT (id, tenant_id, last_inbound_at) ON awcms_inbox_conversations TO awcms_worker;
GRANT DELETE ON awcms_inbox_conversations TO awcms_worker;

-- ---------------------------------------------------------------------------
-- Activity: append-only history of staff and system actions. Ids and closed
-- codes only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_inbox_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  conversation_id uuid NOT NULL,
  kind text NOT NULL,
  -- NULL = the system (the SLA job).
  actor_tenant_user_id uuid,
  -- The assignee an assignment row is about (new for `assigned`, previous for
  -- `unassigned` / `assignee_revoked`).
  subject_tenant_user_id uuid,
  -- A closed code: the new status, a tag id, a revocation reason, a due kind.
  detail_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inbox_activity_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inbox_activity_kind_check CHECK (
    kind IN (
      'assigned',
      'unassigned',
      'assignee_revoked',
      'status_changed',
      'response_recorded',
      'tag_added',
      'tag_removed',
      'sla_breached'
    )
  ),
  CONSTRAINT awcms_inbox_activity_detail_check
    CHECK (detail_code IS NULL OR detail_code ~ '^[a-z0-9_\-]{1,64}$'),
  CONSTRAINT awcms_inbox_activity_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES awcms_inbox_conversations (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT awcms_inbox_activity_actor_fk
    FOREIGN KEY (tenant_id, actor_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inbox_activity_subject_fk
    FOREIGN KEY (tenant_id, subject_tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_inbox_activity_conversation_idx
  ON awcms_inbox_activity (tenant_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS awcms_inbox_activity_created_at_idx
  ON awcms_inbox_activity (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_inbox_activity_actor_idx
  ON awcms_inbox_activity (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_activity_subject_idx
  ON awcms_inbox_activity (tenant_id, subject_tenant_user_id)
  WHERE subject_tenant_user_id IS NOT NULL;

COMMENT ON TABLE awcms_inbox_activity IS
  'Issue #1164 / ADR-0160 -- append-only history of assignment, status, response, tag and SLA actions on a conversation (ids and closed codes only). Removed with its conversation.';

ALTER TABLE awcms_inbox_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inbox_activity FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inbox_activity_tenant_isolation
  ON awcms_inbox_activity
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE UPDATE, DELETE, TRUNCATE ON awcms_inbox_activity FROM awcms_app;
REVOKE ALL ON awcms_inbox_activity FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at) ON awcms_inbox_activity TO awcms_worker;

-- ---------------------------------------------------------------------------
-- Tags: a per-tenant catalogue (soft-deleted) and the conversation links.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_inbox_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  code text NOT NULL,
  label text NOT NULL,
  created_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inbox_tags_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT awcms_inbox_tags_code_check CHECK (code ~ '^[a-z0-9][a-z0-9_\-]{0,47}$'),
  CONSTRAINT awcms_inbox_tags_label_check CHECK (char_length(label) BETWEEN 1 AND 60),
  CONSTRAINT awcms_inbox_tags_deleted_pair_check
    CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  CONSTRAINT awcms_inbox_tags_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_inbox_tags_deleted_by_fk
    FOREIGN KEY (tenant_id, deleted_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_inbox_tags_live_code_key
  ON awcms_inbox_tags (tenant_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_tags_created_by_idx
  ON awcms_inbox_tags (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_inbox_tags_deleted_by_idx
  ON awcms_inbox_tags (tenant_id, deleted_by)
  WHERE deleted_by IS NOT NULL;

COMMENT ON TABLE awcms_inbox_tags IS
  'Issue #1164 / ADR-0160 -- a tenant''s inbox tag catalogue (code and label), authored by an administrator and soft-deleted.';

ALTER TABLE awcms_inbox_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inbox_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inbox_tags_tenant_isolation
  ON awcms_inbox_tags
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_inbox_tags FROM awcms_app;
REVOKE ALL ON awcms_inbox_tags FROM awcms_worker;
GRANT SELECT (id, tenant_id, created_at) ON awcms_inbox_tags TO awcms_worker;

CREATE TABLE IF NOT EXISTS awcms_inbox_conversation_tags (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  conversation_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_inbox_conversation_tags_pkey
    PRIMARY KEY (tenant_id, conversation_id, tag_id),
  CONSTRAINT awcms_inbox_conversation_tags_conversation_fk
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES awcms_inbox_conversations (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT awcms_inbox_conversation_tags_tag_fk
    FOREIGN KEY (tenant_id, tag_id)
    REFERENCES awcms_inbox_tags (tenant_id, id),
  CONSTRAINT awcms_inbox_conversation_tags_created_by_fk
    FOREIGN KEY (tenant_id, created_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_inbox_conversation_tags_tag_idx
  ON awcms_inbox_conversation_tags (tenant_id, tag_id);

CREATE INDEX IF NOT EXISTS awcms_inbox_conversation_tags_created_at_idx
  ON awcms_inbox_conversation_tags (tenant_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_inbox_conversation_tags_created_by_idx
  ON awcms_inbox_conversation_tags (tenant_id, created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON TABLE awcms_inbox_conversation_tags IS
  'Issue #1164 / ADR-0160 -- which tags a conversation carries (at most 20, enforced by sql/384). Removed with its conversation.';

ALTER TABLE awcms_inbox_conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_inbox_conversation_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_inbox_conversation_tags_tenant_isolation
  ON awcms_inbox_conversation_tags
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE TRUNCATE ON awcms_inbox_conversation_tags FROM awcms_app;
REVOKE ALL ON awcms_inbox_conversation_tags FROM awcms_worker;
GRANT SELECT (tenant_id, conversation_id, created_at) ON awcms_inbox_conversation_tags TO awcms_worker;
