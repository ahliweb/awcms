-- Email module — tenant-safe schema, RLS, delivery queue, and ABAC
-- permissions (ported from awcms-mini email epic #492, migrations
-- 020/021/023/024, folded into one coherent migration since awcms starts
-- from an empty email schema — no pre-existing data to ALTER through the
-- text->jsonb body-column conversion mini's 021 performed).
--
-- Four tables. An `email_recipients` table is deliberately NOT created: each
-- `awcms_email_messages` row already IS one recipient's delivery unit (one
-- row = one send attempt to one address), the same "one row per delivery
-- unit" shape `awcms_object_sync_queue` already uses. A bulk announcement
-- enqueues N `email_messages` rows sharing a `correlation_id`, rather than
-- one message row fanning out to many recipients internally.
--
-- ENABLE + FORCE RLS is applied inline on every tenant-scoped table here
-- (the convention every table added since migration 002 follows).
--
-- No `GRANT ... TO awcms_worker`/`awcms_app` block: those least-privilege
-- roles do not exist in this repo yet (the app/worker connect as the
-- migration owner via DATABASE_URL), so a GRANT would fail — omitted, to be
-- added alongside the roles when they are introduced.
--
-- Sensitive-data handling (doc 04 §Alur perlindungan data sensitif) reused
-- verbatim from `profile-identity/domain/identifier.ts`: recipient addresses
-- are stored as `to_address` (normalized) + `to_address_hash` (sha256) +
-- `to_address_masked`. `to_address` itself must be retained — a provider
-- adapter cannot deliver an email knowing only a hash — but every
-- diagnostic/log/list surface reads `to_address_masked`, never `to_address`
-- (enforced at the application layer).
--
-- Rendered body is intentionally NOT a column here (no
-- `rendered_html_body`/`rendered_text_body`): `template_key` + `variables`
-- (jsonb) are enough for the dispatcher to render on demand via the template
-- renderer. Callers must not put a long-lived raw secret in `variables`
-- beyond what a single delivery attempt needs (a password reset token is
-- hashed at rest in its own auth table, never persisted here).

-- Template body columns are `jsonb` per-locale from the start
-- (`{ "en": "...", "id": "..." }`, doc 04 §Konten multi-bahasa "JSONB
-- per-locale") — chosen over a separate translations table because templates
-- are low-cardinality and always read as a whole row. `restored_at`/
-- `restored_by` support the dedicated restore action (template is
-- master/config data an admin may legitimately want to undelete).
CREATE TABLE IF NOT EXISTS awcms_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  template_key text NOT NULL,
  name text NOT NULL,
  subject_template jsonb NOT NULL,
  text_body_template jsonb,
  html_body_template jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  delete_reason text,
  restored_at timestamptz,
  restored_by uuid,
  CONSTRAINT awcms_email_templates_template_key_format_check
    CHECK (template_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT awcms_email_templates_has_body_check
    CHECK (text_body_template IS NOT NULL OR html_body_template IS NOT NULL)
);

-- Business key reusable after soft delete, same partial-unique pattern doc
-- 04 §Soft delete standard prescribes.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_email_templates_tenant_key_idx
  ON awcms_email_templates (tenant_id, template_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS awcms_email_templates_tenant_idx
  ON awcms_email_templates (tenant_id)
  WHERE deleted_at IS NULL;

ALTER TABLE awcms_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_templates_tenant_isolation
  ON awcms_email_templates
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  correlation_id text,
  category text NOT NULL,
  template_key text,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'queued',
  to_address text NOT NULL,
  to_address_hash text NOT NULL,
  to_address_masked text NOT NULL,
  subject text NOT NULL,
  variables jsonb,
  variables_hash text,
  provider_name text,
  provider_message_id text,
  retry_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT awcms_email_messages_category_format_check
    CHECK (category ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT awcms_email_messages_priority_check
    CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT awcms_email_messages_status_check
    CHECK (status IN (
      'queued', 'sending', 'sent', 'failed', 'retry_wait', 'cancelled',
      'suppressed'
    ))
);

-- Dispatcher polling query shape: one tenant at a time,
-- WHERE tenant_id = ? AND status IN ('queued','retry_wait') AND
-- (next_attempt_at IS NULL OR next_attempt_at <= now()) ORDER BY created_at
-- ... FOR UPDATE SKIP LOCKED. `next_attempt_at` doubles as the claim lease
-- expiry while status = 'sending' (no separate lease column), same reuse
-- `object-dispatch.ts` already established.
CREATE INDEX IF NOT EXISTS awcms_email_messages_dispatch_idx
  ON awcms_email_messages (tenant_id, status, next_attempt_at);

-- Admin/diagnostics list view: filter by tenant, optionally by category,
-- newest first.
CREATE INDEX IF NOT EXISTS awcms_email_messages_tenant_category_idx
  ON awcms_email_messages (tenant_id, category, created_at DESC);

-- Suppression-check / recent-send lookups — never scanned by `to_address`
-- itself.
CREATE INDEX IF NOT EXISTS awcms_email_messages_recipient_hash_idx
  ON awcms_email_messages (tenant_id, to_address_hash);

ALTER TABLE awcms_email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_messages_tenant_isolation
  ON awcms_email_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  message_id uuid NOT NULL REFERENCES awcms_email_messages (id),
  attempt_no integer NOT NULL,
  outcome text NOT NULL,
  provider_name text,
  -- Pre-redacted by the caller before insert — never the provider's raw
  -- response body. Truncated, not full payload retention.
  provider_response_snippet text,
  error_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_email_delivery_attempts_outcome_check
    CHECK (outcome IN ('success', 'failure')),
  CONSTRAINT awcms_email_delivery_attempts_attempt_no_check
    CHECK (attempt_no > 0),
  CONSTRAINT awcms_email_delivery_attempts_unique_attempt
    UNIQUE (message_id, attempt_no)
);

-- Reverse "all attempts for this tenant, newest first" diagnostics query.
CREATE INDEX IF NOT EXISTS awcms_email_delivery_attempts_tenant_idx
  ON awcms_email_delivery_attempts (tenant_id, attempted_at DESC);

-- FK index (message_id) for the "all attempts for this message" detail view.
CREATE INDEX IF NOT EXISTS awcms_email_delivery_attempts_message_idx
  ON awcms_email_delivery_attempts (message_id);

ALTER TABLE awcms_email_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_delivery_attempts_tenant_isolation
  ON awcms_email_delivery_attempts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Bounce/complaint/manual block list. `recipient_hash`-only lookup key (no
-- need to retain the raw address once suppressed) with `recipient_masked`
-- kept solely for admin display.
CREATE TABLE IF NOT EXISTS awcms_email_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  recipient_hash text NOT NULL,
  recipient_masked text NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_email_suppression_list_reason_check
    CHECK (reason IN ('bounced', 'complained', 'manual', 'unsubscribed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_email_suppression_list_tenant_hash_idx
  ON awcms_email_suppression_list (tenant_id, recipient_hash);

ALTER TABLE awcms_email_suppression_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_email_suppression_list FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_email_suppression_list_tenant_isolation
  ON awcms_email_suppression_list
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ABAC permissions consumed by the email admin/diagnostics endpoints. RLS
-- already isolates by tenant; these gate the template CRUD/restore, queue
-- read/cancel, suppression CRUD, and the two-tier notification/announcement
-- enqueue surfaces. `notification.create` is required for every enqueue;
-- `announcement.create` is REQUIRED IN ADDITION when targeting a role or the
-- whole tenant (unbounded, higher risk) — a role granted only
-- `notification.create` can message specific known users but cannot blast an
-- entire role/tenant.
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('email', 'template', 'read', 'Read tenant email templates'),
  ('email', 'template', 'create', 'Create an email template'),
  ('email', 'template', 'update', 'Update an email template'),
  ('email', 'template', 'delete', 'Delete (soft) an email template'),
  ('email', 'template', 'restore', 'Restore a soft-deleted email template'),
  ('email', 'message', 'read', 'Read/diagnose tenant email queue'),
  ('email', 'message', 'cancel', 'Cancel a still-queued (queued/retry_wait) email message before it sends'),
  ('email', 'suppression', 'read', 'Read the email suppression list'),
  ('email', 'suppression', 'create', 'Manually suppress a recipient address'),
  ('email', 'suppression', 'delete', 'Remove a manual suppression entry'),
  ('email', 'notification', 'create', 'Enqueue an email notification to an explicit set of users'),
  ('email', 'announcement', 'create', 'Enqueue a bulk email announcement to a role or the whole tenant')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
