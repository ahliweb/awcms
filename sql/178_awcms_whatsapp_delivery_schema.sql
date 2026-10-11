-- WhatsApp delivery queue, attempt ledger, consent store and suppression list
-- (Issue #963, ADR-0133 phase 1). Module `whatsapp_delivery`, inert behind
-- `WHATSAPP_ENABLED`.
--
-- ## "No second outbox", stated the way ADR-0133 section 3 states it
--
-- This is a channel queue table, the repo's THIRD (after `awcms_email_messages`
-- and `awcms_push_messages`). It is NOT a mechanism of its own: the lease is the
-- one email/push/object-sync already use (claim with `FOR UPDATE SKIP LOCKED`,
-- `next_attempt_at` doubles as the claim lease expiry, send OUTSIDE any
-- transaction, finalise per row), and it joins neither `awcms_domain_events`
-- (a provider call inside the claim transaction would violate ADR-0006 — the
-- reason ADR-0074 gave for push) nor `awcms_email_messages` (a mixed-shape
-- table with two dispatchers contending). What the rule forbids is a SECOND
-- WHATSAPP queue — one per consuming domain. Booking, hr_payroll, commerce and
-- every later consumer enqueue into THIS table through the capability port.
--
-- ## The phone number: three columns, one reader
--
-- `recipient` (E.164, raw) exists because no adapter can deliver to a hash.
-- `recipient_hash` is what suppression/consent lookups, rate limits and
-- duplicate detection key on. It is `<keyId>:<hex HMAC-SHA256>` under a SECRET
-- key ring (`WHATSAPP_RECIPIENT_HASH_KEYS`), never a plain or tenant-salted
-- hash: the number space is small enough that anything without a secret key is
-- invertible, and consent/suppression rows hold no plaintext to re-hash later. `recipient_masked` is what
-- every list, log line, audit row and event reads. Only the dispatcher and the
-- enqueue path touch the raw column.
--
-- ## Secrets are cleared at a terminal state
--
-- A `security`-class message (an OTP) carries a secret in `variables` and in the
-- rendered `body`. `contains_secret` is stamped at enqueue so finalisation needs
-- no template lookup; on reaching ANY terminal status the dispatcher (and
-- cancel) overwrite `body` with '' and `variables` with '{}'.

CREATE TABLE IF NOT EXISTS awcms_whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Caller-supplied, required. A replay returns the existing row.
  idempotency_key text NOT NULL,
  -- The caller's own record id, for reading status back. Never a dedupe key.
  correlation_id text,
  template_key text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  -- Copied from the template registration at enqueue; a caller cannot choose it.
  purpose text NOT NULL,
  recipient text NOT NULL,
  recipient_hash text NOT NULL,
  recipient_masked text NOT NULL,
  -- Set only when the caller addressed a profile; lets a data-subject request
  -- reach the row. Composite FK because RLS does not apply to FK checks.
  profile_id uuid,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  contains_secret boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued',
  not_before timestamptz,
  expires_at timestamptz,
  provider_name text,
  provider_message_id text,
  failure_code text,
  retry_count integer NOT NULL DEFAULT 0,
  -- Scheduled send time while queued (a reminder's `notBefore`), retry backoff
  -- while `retry_wait`, and the CLAIM LEASE EXPIRY while `sending`.
  next_attempt_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT awcms_whatsapp_messages_profile_fk
    FOREIGN KEY (tenant_id, profile_id)
    REFERENCES awcms_profiles (tenant_id, id),
  CONSTRAINT awcms_whatsapp_messages_template_key_format_check
    CHECK (template_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_whatsapp_messages_purpose_check
    CHECK (purpose IN ('transactional', 'security', 'marketing')),
  CONSTRAINT awcms_whatsapp_messages_status_check
    CHECK (status IN (
      'queued', 'sending', 'sent', 'failed', 'retry_wait', 'cancelled',
      'expired'
    )),
  CONSTRAINT awcms_whatsapp_messages_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  -- ADR-0133 section 4: an OTP that arrives after its validity is worse than
  -- none, so a security message without an expiry is not representable.
  CONSTRAINT awcms_whatsapp_messages_security_expiry_check
    CHECK (purpose <> 'security' OR expires_at IS NOT NULL),
  CONSTRAINT awcms_whatsapp_messages_idempotency_unique
    UNIQUE (tenant_id, idempotency_key)
);

-- The dispatcher's claim predicate, in its exact column order.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_dispatch_idx
  ON awcms_whatsapp_messages (tenant_id, status, next_attempt_at);

-- `getStatusByCorrelation` / `cancelByCorrelation`.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_correlation_idx
  ON awcms_whatsapp_messages (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Per-recipient rate limit at enqueue (count over a trailing window).
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_recipient_idx
  ON awcms_whatsapp_messages (tenant_id, recipient_hash, created_at);

-- Diagnostics list, newest first. Also serves the per-tenant rate-limit count.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_created_idx
  ON awcms_whatsapp_messages (tenant_id, created_at DESC);

-- The index `db:fk-index:check` requires for the composite profile FK.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_profile_idx
  ON awcms_whatsapp_messages (tenant_id, profile_id)
  WHERE profile_id IS NOT NULL;

-- The retention sweep's path: TERMINAL rows, oldest first, by the moment a row
-- stopped moving.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_messages_retention_idx
  ON awcms_whatsapp_messages (tenant_id, status, updated_at);

ALTER TABLE awcms_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_messages_tenant_isolation
  ON awcms_whatsapp_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The attempt ledger's composite FK targets this key.
ALTER TABLE awcms_whatsapp_messages
  ADD CONSTRAINT awcms_whatsapp_messages_tenant_id_key UNIQUE (tenant_id, id);

-- ---------------------------------------------------------------------------
-- Per-attempt ledger. One row per ATTEMPT. Never the body, never the number.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  message_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  outcome text NOT NULL,
  provider_name text NOT NULL,
  provider_response_snippet text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_delivery_attempts_message_fk
    FOREIGN KEY (tenant_id, message_id)
    REFERENCES awcms_whatsapp_messages (tenant_id, id),
  CONSTRAINT awcms_whatsapp_delivery_attempts_outcome_check
    CHECK (outcome IN ('success', 'failure')),
  -- An expired-lease re-claim recomputes the same attempt number; the call site
  -- uses ON CONFLICT DO NOTHING so a replay cannot abort the whole pass.
  CONSTRAINT awcms_whatsapp_delivery_attempts_unique_attempt
    UNIQUE (message_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_delivery_attempts_message_idx
  ON awcms_whatsapp_delivery_attempts (tenant_id, message_id);

CREATE INDEX IF NOT EXISTS awcms_whatsapp_delivery_attempts_created_idx
  ON awcms_whatsapp_delivery_attempts (tenant_id, created_at);

ALTER TABLE awcms_whatsapp_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_delivery_attempts_tenant_isolation
  ON awcms_whatsapp_delivery_attempts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Consent store (ADR-0133 section 4).
-- ---------------------------------------------------------------------------
-- Keyed by recipient, NOT by segment, list or campaign audience: being in a
-- segment never implies consent, and a segment definition changing can never
-- turn a non-consenting person into a recipient. The marketing check joins THIS
-- table. Only a hash and a masked form are stored — consent needs to answer
-- "may I send to this number", never "what is this number".
CREATE TABLE IF NOT EXISTS awcms_whatsapp_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  recipient_hash text NOT NULL,
  recipient_masked text NOT NULL,
  -- Only `marketing` needs consent today. A column rather than an implicit
  -- constant so a later purpose is a CHECK change, not a new table.
  purpose text NOT NULL DEFAULT 'marketing',
  status text NOT NULL,
  -- Where the opt-in came from (`admin`, `form`, `import`, `inbound_reply`);
  -- recorded evidence, so it is required.
  source text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  created_by uuid,
  withdrawn_by uuid,
  -- Append-only record of every withdrawal that was later reinstated (who
  -- withdrew, when, who reinstated, on what evidence). Re-granting over a
  -- withdrawn row reverses an opt-out, so the opt-out must stay on the record.
  withdrawal_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_consents_purpose_check
    CHECK (purpose IN ('marketing')),
  CONSTRAINT awcms_whatsapp_consents_status_check
    CHECK (status IN ('granted', 'withdrawn')),
  CONSTRAINT awcms_whatsapp_consents_source_check
    CHECK (char_length(source) BETWEEN 1 AND 64),
  CONSTRAINT awcms_whatsapp_consents_withdrawn_check
    CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  CONSTRAINT awcms_whatsapp_consents_recipient_unique
    UNIQUE (tenant_id, recipient_hash, purpose)
);

-- The admin list (filter by status, newest first). Also the index
-- `db:fk-index:check` wants leading the tenant FK.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_consents_status_idx
  ON awcms_whatsapp_consents (tenant_id, status, updated_at DESC);

ALTER TABLE awcms_whatsapp_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_consents FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_consents_tenant_isolation
  ON awcms_whatsapp_consents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Suppression list: hard failures, "stop" replies, manual entries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_whatsapp_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  recipient_hash text NOT NULL,
  recipient_masked text NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_whatsapp_suppressions_reason_check
    CHECK (reason IN ('hard_failure', 'stop_reply', 'manual')),
  CONSTRAINT awcms_whatsapp_suppressions_recipient_unique
    UNIQUE (tenant_id, recipient_hash)
);

-- The admin list, newest first.
CREATE INDEX IF NOT EXISTS awcms_whatsapp_suppressions_created_idx
  ON awcms_whatsapp_suppressions (tenant_id, created_at DESC);

ALTER TABLE awcms_whatsapp_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_whatsapp_suppressions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_whatsapp_suppressions_tenant_isolation
  ON awcms_whatsapp_suppressions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------
-- `awcms_app` is covered by `sql/019` default privileges. `awcms_worker` runs
-- `whatsapp:dispatch` (claims, updates, writes attempts, and records a
-- hard-failure suppression) and `whatsapp:purge` (deletes terminal rows). It
-- re-reads consents at dispatch time but never writes them. Each grant has a
-- matching `WORKER_ROLE_GRANTS` entry in `scripts/security-readiness.ts`.
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_whatsapp_messages TO awcms_worker;
GRANT SELECT, INSERT, DELETE ON awcms_whatsapp_delivery_attempts TO awcms_worker;
GRANT SELECT ON awcms_whatsapp_consents TO awcms_worker;
GRANT SELECT, INSERT ON awcms_whatsapp_suppressions TO awcms_worker;
