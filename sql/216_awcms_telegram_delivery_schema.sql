-- Telegram delivery: tenant switch, chat-binding handshake, queue and attempt
-- ledger (Issue #965, ADR-0140). Module `telegram_delivery`, inert behind
-- `TELEGRAM_ENABLED`.
--
-- ## One Telegram queue per deployment, and nothing else
--
-- `awcms_telegram_messages` is a channel queue table, the repo's FOURTH after
-- `awcms_email_messages`, `awcms_push_messages` and `awcms_whatsapp_messages`
-- (ADR-0133 section 3 accepted that cost once per channel and ADR-0140 section 8
-- accepts it once more). It uses the lease the others use (claim with
-- `FOR UPDATE SKIP LOCKED`, `next_attempt_at` doubles as the claim lease
-- expiry, send OUTSIDE any transaction, finalise per row). It is not
-- `awcms_domain_events` (a provider call inside the claim transaction would
-- violate ADR-0006) and it is not a facade over the other channels: nothing here
-- is a fallback for them, and none of them falls back to this (ADR-0139).
--
-- ## The chat id: ciphertext, keyed hash, mask
--
-- A Telegram `chat_id` is needed to send, so a one-way hash cannot hold it. It
-- is stored ONLY in `awcms_telegram_bindings.chat_ciphertext`, encrypted with
-- the ADR-0137 helper under AAD (purpose `telegram_chat:v1`, tenant, binding
-- id), so a ciphertext copied to another row or tenant fails authentication.
-- `chat_hash` is a KEYED HMAC (`<keyId>:<hex>`, ring TELEGRAM_CHAT_HASH_KEYS)
-- used for the one-chat-per-principal rule, the `/stop` lookup and the
-- tombstone; `chat_masked` is the only form any list, log, audit row or
-- response carries. Queue rows carry `binding_id`, never the chat id. A CHECK
-- makes "a revoked binding holds no ciphertext" a property of the schema, not of
-- the code that revokes.
--
-- ## A revoked binding keeps its hash
--
-- Revocation nulls `chat_ciphertext` and keeps `chat_hash` as a tombstone: the
-- same chat cannot be re-linked except by a fresh handshake by its owner, and a
-- replayed old `/start` is inert because its code was consumed.

-- ---------------------------------------------------------------------------
-- Tenant-level switch (ADR-0140 section 2, level 2). Off until an administrator
-- holding the high-risk `settings.configure` turns it on, audited.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_settings (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id),
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_settings_updated_by_fk
    FOREIGN KEY (tenant_id, updated_by)
    REFERENCES awcms_tenant_users (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_settings_updated_by_idx
  ON awcms_telegram_settings (tenant_id, updated_by)
  WHERE updated_by IS NOT NULL;

ALTER TABLE awcms_telegram_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_settings_tenant_isolation
  ON awcms_telegram_settings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- One-time link codes. Only the SHA-256 of the 32-random-byte code is stored (a
-- high-entropy secret needs no keyed or slow hash). `code_hash` is UNIQUE across
-- tenants because the webhook has to find the tenant from the code alone
-- (`sql/217`'s narrow bootstrap function); with 256 bits that is not a
-- collision risk and not an oracle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  principal_id uuid NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  -- Set by the atomic consume in the webhook.
  consumed_at timestamptz,
  -- Set when the principal requests a newer code: the previous one stops working.
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_link_codes_principal_fk
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_telegram_link_codes_code_hash_check
    CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT awcms_telegram_link_codes_code_hash_unique UNIQUE (code_hash)
);

-- Per-principal request rate limit and the foreign-key index.
CREATE INDEX IF NOT EXISTS awcms_telegram_link_codes_principal_idx
  ON awcms_telegram_link_codes (tenant_id, principal_id, created_at DESC);

-- The retention sweep's path: codes a day after they expired.
CREATE INDEX IF NOT EXISTS awcms_telegram_link_codes_retention_idx
  ON awcms_telegram_link_codes (tenant_id, expires_at);

ALTER TABLE awcms_telegram_link_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_link_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_link_codes_tenant_isolation
  ON awcms_telegram_link_codes
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Chat bindings: the audited, revocable act that makes a chat addressable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_bindings (
  -- Generated by the application (not by a default alone) because the AAD of
  -- `chat_ciphertext` names it, so it must exist before the row is written.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  principal_id uuid NOT NULL,
  status text NOT NULL,
  chat_ciphertext text,
  chat_hash text NOT NULL,
  hash_key_id text NOT NULL,
  chat_masked text NOT NULL,
  -- Captured by the handshake so the staff member can confirm "is this you?" in
  -- their own authenticated session. Cleared on confirm, reject and expiry.
  display_name text,
  username_masked text,
  pending_expires_at timestamptz,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  revoke_cause text,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_bindings_principal_fk
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_telegram_bindings_revoked_by_fk
    FOREIGN KEY (tenant_id, revoked_by)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_telegram_bindings_status_check
    CHECK (status IN ('pending_confirmation', 'active', 'revoked', 'suspended')),
  CONSTRAINT awcms_telegram_bindings_revoke_cause_check
    CHECK (revoke_cause IS NULL OR revoke_cause IN (
      'self_admin', 'self_stop', 'admin', 'principal_deactivated',
      'module_disabled', 'tenant_disabled', 'tenant_suspended', 'provider_blocked',
      'rejected',
      'confirmation_expired', 'rebound', 'superseded', 'erasure'
    )),
  -- A live binding holds ciphertext; a revoked or suspended one holds none. The
  -- schema says "revocation erased the chat id", not just the code that revokes.
  -- The one other value a non-live row may carry is the subject-data erasure
  -- sentinel (`[erased]...`, ADR-0094's executor): never a real ciphertext.
  CONSTRAINT awcms_telegram_bindings_ciphertext_check
    CHECK (CASE WHEN status IN ('pending_confirmation', 'active')
                THEN chat_ciphertext IS NOT NULL
                ELSE chat_ciphertext IS NULL
                     OR chat_ciphertext LIKE '[erased]%' END),
  CONSTRAINT awcms_telegram_bindings_pending_check
    CHECK ((status = 'pending_confirmation') = (pending_expires_at IS NOT NULL)),
  CONSTRAINT awcms_telegram_bindings_revoked_check
    CHECK ((status IN ('revoked', 'suspended')) = (revoked_at IS NOT NULL)
           AND (status IN ('revoked', 'suspended')) = (revoke_cause IS NOT NULL)),
  CONSTRAINT awcms_telegram_bindings_hash_key_check
    CHECK (chat_hash LIKE hash_key_id || ':%' OR chat_hash LIKE '[erased]%'),
  CONSTRAINT awcms_telegram_bindings_display_name_check
    CHECK (display_name IS NULL OR char_length(display_name) <= 64),
  CONSTRAINT awcms_telegram_bindings_tenant_id_key UNIQUE (tenant_id, id)
);

-- One ACTIVE binding per (tenant, principal): re-binding replaces, audited.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_telegram_bindings_active_principal_key
  ON awcms_telegram_bindings (tenant_id, principal_id)
  WHERE status = 'active';

-- ... and at most one waiting for confirmation, so a second `/start` supersedes
-- the first instead of piling up.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_telegram_bindings_pending_principal_key
  ON awcms_telegram_bindings (tenant_id, principal_id)
  WHERE status = 'pending_confirmation';

-- A chat is live in at most ONE principal per tenant: one chat cannot
-- impersonate two people. (Across a hash-key rotation the same chat has two
-- different hashes; the application checks every ring key's candidate, and this
-- index is the backstop for the same-key race.)
CREATE UNIQUE INDEX IF NOT EXISTS awcms_telegram_bindings_live_chat_key
  ON awcms_telegram_bindings (tenant_id, chat_hash)
  WHERE status IN ('pending_confirmation', 'active');

-- Tombstone lookups (a revoked row keeps its hash).
CREATE INDEX IF NOT EXISTS awcms_telegram_bindings_chat_hash_idx
  ON awcms_telegram_bindings (tenant_id, chat_hash);

CREATE INDEX IF NOT EXISTS awcms_telegram_bindings_principal_idx
  ON awcms_telegram_bindings (tenant_id, principal_id);

CREATE INDEX IF NOT EXISTS awcms_telegram_bindings_revoked_by_idx
  ON awcms_telegram_bindings (tenant_id, revoked_by)
  WHERE revoked_by IS NOT NULL;

-- Retention (revoked bindings 90 days) and the pending-expiry sweep.
CREATE INDEX IF NOT EXISTS awcms_telegram_bindings_retention_idx
  ON awcms_telegram_bindings (tenant_id, status, updated_at);

ALTER TABLE awcms_telegram_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_bindings FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_bindings_tenant_isolation
  ON awcms_telegram_bindings
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- A binding becomes `active` ONLY from the staff member's own authenticated
-- session (ADR-0140 section 3 step 3). The route that confirms it runs as
-- `awcms_app`; the dispatcher and the purge run as `awcms_worker`, which holds
-- UPDATE on this table so it can END bindings (revoke, suspend), and must never
-- be able to promote one. Without this trigger that separation would rest on the
-- worker's code being correct, not on the database: a defect or a compromised
-- job could turn an attacker's `pending_confirmation` chat into a live one.
--
-- Enforced here, in the database, for the two ways a row can BE active: an
-- UPDATE from `pending_confirmation`, and an INSERT. Any other route to `active`
-- (a revoked row coming back) is refused outright. The table's OWNER (the
-- migration role) is exempt so that maintenance and fixtures keep working; it is
-- not a role any runtime process connects as.
--
-- The same trigger closes the other half (audit N2): a role that is not
-- `awcms_app` may only END a binding. It can set `status` to `revoked` or
-- `suspended`, set `chat_ciphertext` to NULL or the erasure sentinel, and NULL
-- the captured display data (or change it only while ending the binding), and
-- nothing else, so even with UPDATE on the column it cannot swap a live
-- binding's ciphertext for one that points at another chat.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_telegram_bindings_activation_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  table_owner text;
BEGIN
  SELECT pg_get_userbyid(c.relowner) INTO table_owner
  FROM pg_class AS c WHERE c.oid = TG_RELID;

  IF current_user = table_owner THEN
    RETURN NEW;
  END IF;

  -- Anyone but the application role may only END a binding.
  IF current_user <> 'awcms_app' AND TG_OP = 'UPDATE' THEN
    IF NEW.status NOT IN ('revoked', 'suspended')
       AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'only the authenticated application role may activate a Telegram binding'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.chat_ciphertext IS DISTINCT FROM OLD.chat_ciphertext
       AND NEW.chat_ciphertext IS NOT NULL
       AND NEW.chat_ciphertext NOT LIKE '[erased]%' THEN
      RAISE EXCEPTION 'only the authenticated application role may write a Telegram chat ciphertext'
        USING ERRCODE = '42501';
    END IF;

    -- The captured display data and the pending window: NULLed, or changed only
    -- in the same statement that ends the binding. Otherwise a worker could dress
    -- a pending binding with another name or keep it pending longer.
    IF (
         (NEW.display_name IS DISTINCT FROM OLD.display_name
          AND NEW.display_name IS NOT NULL)
         OR (NEW.username_masked IS DISTINCT FROM OLD.username_masked
             AND NEW.username_masked IS NOT NULL)
         OR (NEW.pending_expires_at IS DISTINCT FROM OLD.pending_expires_at
             AND NEW.pending_expires_at IS NOT NULL)
       )
       AND NOT (
         NEW.status IN ('revoked', 'suspended')
         AND NEW.status IS DISTINCT FROM OLD.status
       ) THEN
      RAISE EXCEPTION 'only the authenticated application role may write Telegram binding display data'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status <> 'active'
     OR (TG_OP = 'UPDATE' AND OLD.status = 'active') THEN
    RETURN NEW;
  END IF;

  IF current_user <> 'awcms_app' THEN
    RAISE EXCEPTION 'only the authenticated application role may activate a Telegram binding'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' OR OLD.status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'a Telegram binding becomes active only from pending_confirmation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_telegram_bindings_activation_guard
  BEFORE INSERT OR UPDATE OF
    status, chat_ciphertext, display_name, username_masked, pending_expires_at
  ON awcms_telegram_bindings
  FOR EACH ROW
  EXECUTE FUNCTION awcms_telegram_bindings_activation_guard();

-- ---------------------------------------------------------------------------
-- The queue. Operational notices only: `purpose` has exactly one value.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Caller-supplied, required. A replay returns the existing row.
  idempotency_key text NOT NULL,
  -- The caller's own record id, for reading status back. Never a dedupe key.
  correlation_id text,
  template_key text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  -- Copied from the template registration at enqueue; a caller cannot choose it.
  purpose text NOT NULL DEFAULT 'staff_ops',
  -- The recipient, as the TENANT USER the notice is about (ADR-0094's subject).
  principal_id uuid NOT NULL,
  -- The chat is reached ONLY through the binding; never a chat id here.
  binding_id uuid NOT NULL,
  variables jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  -- Mandatory: a notice that arrives a day late is noise. Enforced by the purge
  -- job independently of the dispatcher.
  expires_at timestamptz NOT NULL,
  -- Due time while queued, backoff / `retry_after` while `retry_wait`, and the
  -- CLAIM LEASE EXPIRY while `sending`.
  next_attempt_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0,
  -- Telegram's `message_id` (at-least-once delivery is acknowledged).
  provider_message_id text,
  failure_code text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT awcms_telegram_messages_principal_fk
    FOREIGN KEY (tenant_id, principal_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_telegram_messages_binding_fk
    FOREIGN KEY (tenant_id, binding_id)
    REFERENCES awcms_telegram_bindings (tenant_id, id),
  CONSTRAINT awcms_telegram_messages_template_key_format_check
    CHECK (template_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT awcms_telegram_messages_purpose_check
    CHECK (purpose IN ('staff_ops')),
  CONSTRAINT awcms_telegram_messages_status_check
    CHECK (status IN (
      'queued', 'sending', 'sent', 'failed', 'retry_wait', 'cancelled',
      'expired'
    )),
  CONSTRAINT awcms_telegram_messages_idempotency_key_check
    CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
  CONSTRAINT awcms_telegram_messages_idempotency_unique
    UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT awcms_telegram_messages_tenant_id_key UNIQUE (tenant_id, id)
);

-- The dispatcher's claim predicate, in its exact column order.
CREATE INDEX IF NOT EXISTS awcms_telegram_messages_dispatch_idx
  ON awcms_telegram_messages (tenant_id, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS awcms_telegram_messages_correlation_idx
  ON awcms_telegram_messages (tenant_id, correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Per-binding rate limit at enqueue, per-chat spacing at dispatch, and the
-- "cancel everything queued for this binding" a revocation issues.
CREATE INDEX IF NOT EXISTS awcms_telegram_messages_binding_idx
  ON awcms_telegram_messages (tenant_id, binding_id, created_at);

CREATE INDEX IF NOT EXISTS awcms_telegram_messages_principal_idx
  ON awcms_telegram_messages (tenant_id, principal_id);

-- Diagnostics list, newest first. Also serves the per-tenant rate-limit count.
CREATE INDEX IF NOT EXISTS awcms_telegram_messages_created_idx
  ON awcms_telegram_messages (tenant_id, created_at DESC);

-- The retention sweep's path: TERMINAL rows, by the moment a row stopped moving.
CREATE INDEX IF NOT EXISTS awcms_telegram_messages_retention_idx
  ON awcms_telegram_messages (tenant_id, status, updated_at);

-- The expiry backstop: non-terminal rows past their expiry.
CREATE INDEX IF NOT EXISTS awcms_telegram_messages_expiry_idx
  ON awcms_telegram_messages (tenant_id, expires_at)
  WHERE status IN ('queued', 'retry_wait', 'sending');

ALTER TABLE awcms_telegram_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_messages_tenant_isolation
  ON awcms_telegram_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Per-attempt ledger. One row per ATTEMPT. Never the body, never the chat id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_telegram_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  message_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  outcome text NOT NULL,
  provider_name text NOT NULL,
  provider_response_snippet text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_telegram_delivery_attempts_message_fk
    FOREIGN KEY (tenant_id, message_id)
    REFERENCES awcms_telegram_messages (tenant_id, id),
  CONSTRAINT awcms_telegram_delivery_attempts_outcome_check
    CHECK (outcome IN ('success', 'failure')),
  -- An expired-lease re-claim recomputes the same attempt number; the call site
  -- uses ON CONFLICT DO NOTHING so a replay cannot abort the whole pass.
  CONSTRAINT awcms_telegram_delivery_attempts_unique_attempt
    UNIQUE (message_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS awcms_telegram_delivery_attempts_message_idx
  ON awcms_telegram_delivery_attempts (tenant_id, message_id);

CREATE INDEX IF NOT EXISTS awcms_telegram_delivery_attempts_created_idx
  ON awcms_telegram_delivery_attempts (tenant_id, created_at);

ALTER TABLE awcms_telegram_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_telegram_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_telegram_delivery_attempts_tenant_isolation
  ON awcms_telegram_delivery_attempts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------
-- `awcms_app` is covered by `sql/019` default privileges. `awcms_worker` runs
-- `telegram:dispatch` (claims, finalises, writes attempts, suspends/revokes a
-- binding the provider reported unreachable) and `telegram:queue:purge`
-- (expires pending bindings, deletes terminal rows). It reads the tenant switch
-- but never writes it, and it never INSERTs a binding or a link code: those are
-- created only by the authenticated request and the webhook, as `awcms_app`.
-- Each grant has a matching `WORKER_ROLE_GRANTS` entry in
-- `scripts/security-readiness.ts`.
GRANT SELECT ON awcms_telegram_settings TO awcms_worker;
GRANT SELECT, DELETE ON awcms_telegram_link_codes TO awcms_worker;
-- COLUMN-scoped UPDATE (audit N2): the dispatcher and purge only ever END a
-- binding (status, the revocation stamp, nulling the ciphertext and the captured
-- display data). They never need to write `chat_hash`, `chat_masked`,
-- `principal_id` or a new ciphertext, so they cannot: a worker that holds the key
-- ring must not be able to re-point a live binding at another chat.
GRANT SELECT, DELETE ON awcms_telegram_bindings TO awcms_worker;
GRANT UPDATE (
  status, chat_ciphertext, display_name, username_masked, pending_expires_at,
  revoked_at, revoke_cause, revoked_by, updated_at
) ON awcms_telegram_bindings TO awcms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_telegram_messages TO awcms_worker;
GRANT SELECT, INSERT, DELETE ON awcms_telegram_delivery_attempts TO awcms_worker;
