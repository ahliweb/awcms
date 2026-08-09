-- Push delivery queue (Issue #465, epic #463, ADR-0074).
--
-- ## Why a SECOND outbox and not the domain-event one
--
-- `awcms_domain_events` looks like the right place to hang push delivery on,
-- and it is not. `domain-event-runtime/application/dispatch-domain-events.ts`
-- states in its own header that CLAIM + handler + FINALIZE run in ONE
-- transaction, deliberately, because its built-in consumers are same-process
-- with no external I/O — and it calls the handler inside that transaction.
-- A push provider is an HTTP call to Google or to a browser vendor's endpoint,
-- and ADR-0006 forbids external network calls inside a DB transaction. Its own
-- `infrastructure/broker-adapter-port.ts` already wrote down the consequence:
-- an out-of-transaction consumer "would need the lease-based shape back".
--
-- So this is the lease-based shape, copied from the three dispatchers that
-- already run it here (`email/application/email-dispatch.ts`,
-- `sync-storage/application/object-dispatch.ts`, `lib/edge-cache/purge-queue.ts`):
-- claim with `FOR UPDATE SKIP LOCKED`, reuse `next_attempt_at` as the claim
-- lease expiry rather than adding a lease column, send OUTSIDE any transaction,
-- finalize per row.
--
-- ## Three tables, and the one that is deliberately absent
--
-- There is no `awcms_push_recipients`. One `awcms_push_messages` row IS one
-- delivery unit — one payload aimed at one subscription — the same "one row per
-- delivery unit" shape `awcms_email_messages` and `awcms_object_sync_queue`
-- use. A broadcast enqueues N rows sharing a `correlation_id`.
--
-- ## Endpoints/tokens are credentials, and are treated like recipient addresses
--
-- A Web Push endpoint URL and an FCM registration token are both bearer-ish:
-- anyone holding one can push to that device until it is rotated. They follow
-- the same three-column discipline `awcms_email_messages` uses for recipient
-- addresses (`profile-identity/domain/identifier.ts`): the raw value is
-- retained because no adapter can deliver to a hash, `*_hash` is what every
-- lookup and dedupe key uses, and `*_masked` is what every diagnostic, list
-- surface, and log line reads. Nothing outside the dispatcher and the
-- subscription directory may select the raw column.
--
-- That is also why a device token can never ride a domain event even if
-- somebody wanted it to: `domain-event-runtime/domain/envelope.ts` rejects any
-- payload key containing "token". The event says WHO and WHAT; resolving that
-- to endpoints happens here.

-- ---------------------------------------------------------------------------
-- Subscriptions — one row per (tenant user, device/browser)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  -- Composite FK carrying `tenant_id`, the `sql/027` pattern: referential
  -- integrity checks run as the table OWNER and therefore bypass RLS, so a
  -- plain `REFERENCES awcms_tenant_users (id)` would happily accept another
  -- tenant's user id. The target constraint is
  -- `awcms_tenant_users_tenant_id_key` (sql/027).
  tenant_user_id uuid NOT NULL,
  transport text NOT NULL,
  -- Raw endpoint (Web Push) or registration token (FCM). Retained because a
  -- provider adapter cannot deliver knowing only a hash — see the header.
  endpoint text NOT NULL,
  endpoint_hash text NOT NULL,
  endpoint_masked text NOT NULL,
  -- Web Push (RFC 8291) key material. Both NULL for `fcm`; the CHECK below
  -- makes that structural rather than conventional.
  p256dh_key text,
  auth_secret text,
  user_agent_summary text,
  status text NOT NULL DEFAULT 'active',
  disabled_reason text,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_push_subscriptions_tenant_user_fk
    FOREIGN KEY (tenant_id, tenant_user_id)
    REFERENCES awcms_tenant_users (tenant_id, id),
  CONSTRAINT awcms_push_subscriptions_transport_check
    CHECK (transport IN ('web_push', 'fcm')),
  CONSTRAINT awcms_push_subscriptions_status_check
    CHECK (status IN ('active', 'disabled')),
  -- Web Push needs both keys; FCM must carry neither. Without this a
  -- half-registered Web Push row would sit in the queue failing forever with
  -- an encryption error that reads like a provider outage.
  CONSTRAINT awcms_push_subscriptions_keys_match_transport_check
    CHECK (
      (transport = 'web_push'
        AND p256dh_key IS NOT NULL AND auth_secret IS NOT NULL)
      OR (transport = 'fcm'
        AND p256dh_key IS NULL AND auth_secret IS NULL)
    ),
  -- Re-registering the same browser must UPDATE, never accumulate. The hash is
  -- the business key; the raw endpoint is never compared.
  CONSTRAINT awcms_push_subscriptions_endpoint_unique
    UNIQUE (tenant_id, endpoint_hash)
);

-- The dispatcher's fan-out path: every active subscription for one recipient.
-- Also the index `db:fk-index:check` requires for the composite FK above.
CREATE INDEX IF NOT EXISTS awcms_push_subscriptions_tenant_user_idx
  ON awcms_push_subscriptions (tenant_id, tenant_user_id);

-- The retention sweep's path: disabled rows, oldest first.
CREATE INDEX IF NOT EXISTS awcms_push_subscriptions_status_updated_idx
  ON awcms_push_subscriptions (tenant_id, status, updated_at);

ALTER TABLE awcms_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_push_subscriptions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_push_subscriptions_tenant_isolation
  ON awcms_push_subscriptions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- A composite FK can only target a UNIQUE key, so this must exist BEFORE the
-- queue table below declares `REFERENCES awcms_push_subscriptions (tenant_id, id)`.
-- Declared here rather than inline in CREATE TABLE because the primary key is
-- `id` alone; this is the extra key the tenant-carrying FK needs.
ALTER TABLE awcms_push_subscriptions
  ADD CONSTRAINT awcms_push_subscriptions_tenant_id_key UNIQUE (tenant_id, id);

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS awcms_push_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  correlation_id text,
  -- Dotted, same shape as `awcms_email_messages.category` — what KIND of push
  -- this is, so diagnostics and (later) per-category opt-out have a key.
  category text NOT NULL,
  subscription_id uuid NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'queued',
  title text NOT NULL,
  body text NOT NULL,
  -- Click-through path. Same-origin path only (validated in the application
  -- layer): a queue row must never be able to aim a notification at another
  -- origin.
  target_path text,
  data jsonb,
  provider_name text,
  provider_message_id text,
  retry_count integer NOT NULL DEFAULT 0,
  -- Doubles as the CLAIM LEASE EXPIRY while status = 'sending' — no separate
  -- lease column, the reuse `sql/014` and `object-dispatch.ts` established.
  next_attempt_at timestamptz,
  last_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT awcms_push_messages_subscription_fk
    FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES awcms_push_subscriptions (tenant_id, id),
  CONSTRAINT awcms_push_messages_category_format_check
    CHECK (category ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT awcms_push_messages_priority_check
    CHECK (priority IN ('low', 'normal', 'high')),
  CONSTRAINT awcms_push_messages_status_check
    CHECK (status IN (
      'queued', 'sending', 'sent', 'failed', 'retry_wait', 'cancelled'
    ))
);

-- The dispatcher's claim predicate, in its exact column order:
-- WHERE tenant_id = ? AND status IN (...) AND next_attempt_at <= ?
CREATE INDEX IF NOT EXISTS awcms_push_messages_dispatch_idx
  ON awcms_push_messages (tenant_id, status, next_attempt_at);

-- Diagnostics list: filter by tenant + category, newest first.
CREATE INDEX IF NOT EXISTS awcms_push_messages_tenant_category_idx
  ON awcms_push_messages (tenant_id, category, created_at DESC);

-- The fan-out/cascade path AND the index `db:fk-index:check` requires for the
-- composite FK: every queued row aimed at one subscription.
CREATE INDEX IF NOT EXISTS awcms_push_messages_subscription_idx
  ON awcms_push_messages (tenant_id, subscription_id);

-- The retention sweep's path: TERMINAL rows, oldest first. Deliberately keyed
-- on `updated_at`, the moment a row stopped moving — not `created_at`, which
-- would make a long-retried message look older than it is.
CREATE INDEX IF NOT EXISTS awcms_push_messages_retention_idx
  ON awcms_push_messages (tenant_id, status, updated_at);

ALTER TABLE awcms_push_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_push_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_push_messages_tenant_isolation
  ON awcms_push_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Same reason as above: the attempt ledger's composite FK targets this key.
ALTER TABLE awcms_push_messages
  ADD CONSTRAINT awcms_push_messages_tenant_id_key UNIQUE (tenant_id, id);

-- ---------------------------------------------------------------------------
-- Per-attempt ledger
-- ---------------------------------------------------------------------------
-- One row per ATTEMPT, not per message — the same shape (and the same cost
-- profile) as `awcms_email_delivery_attempts`. A message that exhausts its
-- retries writes several rows, which is exactly why this table carries its own
-- retention descriptor from the day it is created.
CREATE TABLE IF NOT EXISTS awcms_push_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  message_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  outcome text NOT NULL,
  provider_name text NOT NULL,
  -- Never the payload, never the endpoint — a truncated provider reply only.
  provider_response_snippet text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_push_delivery_attempts_message_fk
    FOREIGN KEY (tenant_id, message_id)
    REFERENCES awcms_push_messages (tenant_id, id),
  CONSTRAINT awcms_push_delivery_attempts_outcome_check
    CHECK (outcome IN ('success', 'failure')),
  -- Required by the expired-lease re-claim: a crash after this insert but
  -- before FINALIZE leaves `retry_count` untouched, so the re-claiming pass
  -- computes the same `attempt_no`. Without the constraint plus an
  -- `ON CONFLICT DO NOTHING` at the call site, an unhandled 23505 would abort
  -- the whole pass and take the other claimed messages with it — the failure
  -- `email-dispatch.ts` documents having hit (Issue #143).
  CONSTRAINT awcms_push_delivery_attempts_unique_attempt
    UNIQUE (message_id, attempt_no)
);

-- Diagnostics ("show me this message's attempts") AND the index
-- `db:fk-index:check` requires for the composite FK.
CREATE INDEX IF NOT EXISTS awcms_push_delivery_attempts_message_idx
  ON awcms_push_delivery_attempts (tenant_id, message_id);

-- The retention sweep's path.
CREATE INDEX IF NOT EXISTS awcms_push_delivery_attempts_created_idx
  ON awcms_push_delivery_attempts (tenant_id, created_at);

ALTER TABLE awcms_push_delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_push_delivery_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_push_delivery_attempts_tenant_isolation
  ON awcms_push_delivery_attempts
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- ---------------------------------------------------------------------------
-- Least-privilege grants
-- ---------------------------------------------------------------------------
-- `awcms_app` needs nothing here: `sql/019` sets ALTER DEFAULT PRIVILEGES for
-- it, so tables created afterwards are already reachable.
--
-- `awcms_worker` runs `push:dispatch` (claims, updates, writes attempts) and
-- `push:queue:purge` (deletes terminal rows), so it needs the full set. The
-- DELETE is the one to notice: `sql/091` records what happens without it — the
-- purge runs, reports success, and removes zero rows, a failure that reads as
-- "nothing to delete". Every grant here has a matching entry in
-- `WORKER_ROLE_GRANTS` (`scripts/security-readiness.ts`), and
-- `tests/repo-inventory.test.ts` asserts the two sides agree.
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_push_subscriptions TO awcms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_push_messages TO awcms_worker;
GRANT SELECT, INSERT, DELETE ON awcms_push_delivery_attempts TO awcms_worker;
