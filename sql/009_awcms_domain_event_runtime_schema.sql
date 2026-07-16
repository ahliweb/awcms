-- Domain Event Runtime — transactional, versioned domain-event outbox,
-- idempotent consumers, retries, per-aggregate/order-key ordering, and
-- dead-letter handling. Ported from awcms-mini's proven
-- `domain-event-runtime` module (mini migration
-- `056_awcms_mini_domain_event_runtime_schema.sql`), renamed to this repo's
-- `awcms_` table/prefix convention.
--
-- The generic, provider-neutral, MULTI-consumer counterpart to a
-- single-purpose single-consumer outbox: one event can fan out to MANY
-- registered consumers (decided at publish time from a static, reviewed
-- source-code consumer registry), with explicit per-aggregate/order-key
-- ordering (never a global total order) and operator-safe replay.
--
-- Tables:
--
-- 1. `awcms_domain_events` — the outbox itself. Append-only (never
--    UPDATEd/DELETEd by application code — immutable history, doc 04/10
--    posted/append-only convention). One row per published domain event,
--    written in the SAME transaction as the source state change that
--    caused it ("source state and outbox record commit atomically").
--    `event_sequence` is a plain bigint IDENTITY column — a strictly
--    monotonic, gap-tolerant, per-table insertion-order counter used ONLY
--    as an unambiguous ordering tiebreaker (a random UUID primary key has
--    no ordering property), never a business identifier.
-- 2. `awcms_domain_event_deliveries` — one row per (event, registered
--    consumer) pair, created by the SAME transaction that inserts the
--    event. Both the retry/backoff/dead-letter state machine AND the
--    structural idempotency mechanism: a consumer can only ever have ONE
--    non-replay delivery row per event (partial unique index below), so
--    duplicate dispatch of the SAME event to the SAME consumer is
--    structurally impossible. `status` deliberately has NO transient
--    "claimed" value — this module's reference consumers are same-process,
--    DB-only handlers with no external I/O, so `application/dispatch-
--    domain-events.ts` claims, executes, AND finalizes a delivery inside
--    ONE transaction; a crash mid-handler rolls the whole transaction back
--    automatically, returning the row to `pending` with no stale-claim
--    state ever durably observed. A future OUT-OF-TRANSACTION broker
--    adapter (`infrastructure/broker-adapter-port.ts`) is a documented,
--    not-yet-implemented extension that would add a lease-based state back.
-- 3. `awcms_domain_event_consumer_effects` — a generic, reusable
--    idempotency marker table ANY consumer handler can use (via
--    `applyConsumerEffectOnce`, `application/consumer-effect.ts`) to
--    guarantee its OWN side effect runs at most once per (consumer, event)
--    even if the SAME event is legitimately redelivered (a crash between
--    the handler's own commit and the delivery-row finalize, or an
--    operator-triggered replay).
-- 4. `awcms_domain_event_consumer_state` — per (tenant, consumer)
--    pause/resume flag. An operator can pause a misbehaving consumer
--    without touching the dispatcher process or any other consumer.
-- 5. `awcms_domain_event_replays` — append-only audit trail of every
--    replay action (who, when, reason, original/replay delivery linkage).
--    Separate from the generic `awcms_audit_events` table (which ALSO gets
--    a row per replay) because this table additionally carries the
--    structured delivery linkage needed to reconstruct replay lineage.
-- 6. `awcms_domain_event_activity_daily` — a small denormalized read-model
--    projection (tenant_id, activity_date, event_type, event_count),
--    maintained by this module's REFERENCE read-model projection consumer
--    (`activityRollupProjectorConsumer`) — proof the dispatcher can drive a
--    real read-optimized aggregate. Owned entirely by this module (no
--    cross-module shared-table write).
--
-- Also introduces the generic idempotency store `awcms_idempotency_keys`
-- (mirrors awcms-mini's `awcms_mini_idempotency_keys`, mini migration 012):
-- this module's dead-letter replay endpoint is the FIRST high-risk mutation
-- in this repo to require the standard `Idempotency-Key` wrapper (doc 10),
-- so the shared store lands here with its first real consumer. Any future
-- high-risk mutation endpoint reuses the same table with its own
-- `request_scope` string.
--
-- Every table is tenant-scoped with the standard RLS tenant-isolation
-- policy (doc 04/10) — no RLS-free/global table is introduced.

-- Generic idempotency store (see file header) — first consumed by this
-- module's replay endpoint (`src/pages/api/v1/domain-events/deliveries/
-- [id]/replay.ts` via `_shared/idempotency.ts`).
CREATE TABLE IF NOT EXISTS awcms_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  request_scope text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_idempotency_keys_scope_key
  ON awcms_idempotency_keys (tenant_id, request_scope, idempotency_key);

CREATE INDEX IF NOT EXISTS awcms_idempotency_keys_tenant_created_idx
  ON awcms_idempotency_keys (tenant_id, created_at DESC);

ALTER TABLE awcms_idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_idempotency_keys_tenant_isolation
  ON awcms_idempotency_keys
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 1. The outbox (append-only).
CREATE TABLE IF NOT EXISTS awcms_domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  event_type text NOT NULL,
  event_version text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version integer,
  order_key text NOT NULL,
  correlation_id text,
  causation_id text,
  producer_module text NOT NULL,
  schema_ref text,
  actor_tenant_user_id uuid,
  actor_profile_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  -- Each segment allows hyphens, including the first — every real event
  -- name in this repo uses a hyphenated `awcms` namespace prefix (e.g.
  -- `awcms.domain-event-runtime.sample.recorded`); matches
  -- `domain/envelope.ts`'s `EVENT_TYPE_PATTERN` exactly.
  CONSTRAINT awcms_domain_events_event_type_format_check
    CHECK (event_type ~ '^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)+$'),
  CONSTRAINT awcms_domain_events_event_version_format_check
    CHECK (event_version ~ '^[0-9]+\.[0-9]+$'),
  CONSTRAINT awcms_domain_events_aggregate_type_length_check
    CHECK (char_length(aggregate_type) BETWEEN 1 AND 100),
  CONSTRAINT awcms_domain_events_order_key_length_check
    CHECK (char_length(order_key) BETWEEN 1 AND 300),
  CONSTRAINT awcms_domain_events_producer_module_length_check
    CHECK (char_length(producer_module) BETWEEN 1 AND 100),
  -- Defense-in-depth payload size bound — the primary enforcement is
  -- application-level (`domain/envelope.ts`'s `validateDomainEventPayload`,
  -- which also rejects secret-shaped values), this is a hard DB backstop.
  CONSTRAINT awcms_domain_events_payload_size_check
    CHECK (octet_length(payload::text) <= 65536)
);

CREATE INDEX IF NOT EXISTS awcms_domain_events_sequence_idx
  ON awcms_domain_events (event_sequence);
CREATE INDEX IF NOT EXISTS awcms_domain_events_tenant_type_idx
  ON awcms_domain_events (tenant_id, event_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS awcms_domain_events_tenant_aggregate_idx
  ON awcms_domain_events (tenant_id, aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS awcms_domain_events_tenant_recorded_idx
  ON awcms_domain_events (tenant_id, recorded_at DESC);

ALTER TABLE awcms_domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_events_tenant_isolation
  ON awcms_domain_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. Per-(event, consumer) delivery/idempotency/retry/DLQ state.
CREATE TABLE IF NOT EXISTS awcms_domain_event_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  event_id uuid NOT NULL REFERENCES awcms_domain_events (id),
  event_sequence bigint NOT NULL,
  event_type text NOT NULL,
  event_version text NOT NULL,
  order_key text NOT NULL,
  consumer_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  last_retry_classification text,
  delivered_at timestamptz,
  dead_letter_at timestamptz,
  dead_letter_reason text,
  replay_of_delivery_id uuid REFERENCES awcms_domain_event_deliveries (id),
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_domain_event_deliveries_status_check
    CHECK (status IN ('pending', 'delivered', 'dead_letter', 'skipped')),
  CONSTRAINT awcms_domain_event_deliveries_attempt_count_check
    CHECK (attempt_count >= 0 AND max_attempts >= 1),
  CONSTRAINT awcms_domain_event_deliveries_consumer_name_length_check
    CHECK (char_length(consumer_name) BETWEEN 1 AND 150)
);

-- Exactly one ORIGINAL (non-replay) delivery per (event, consumer) — the
-- structural half of "duplicate delivery cannot duplicate side effects".
-- Replays intentionally fall outside this constraint (each replay is a new
-- row with `replay_of_delivery_id` set) so the full replay history stays
-- queryable/append-only rather than overwriting the original row.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_domain_event_deliveries_identity_key
  ON awcms_domain_event_deliveries (tenant_id, event_id, consumer_name)
  WHERE replay_of_delivery_id IS NULL;

-- Dispatcher head-of-line query shape: `SELECT DISTINCT ON (order_key) ...
-- WHERE tenant_id = $1 AND consumer_name = $2 AND status = 'pending' ORDER
-- BY order_key, event_sequence` (application/dispatch-domain-events.ts) —
-- this partial index matches that predicate and sort order exactly.
CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_dispatch_idx
  ON awcms_domain_event_deliveries (tenant_id, consumer_name, order_key, event_sequence)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_event_id_idx
  ON awcms_domain_event_deliveries (event_id);
CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_tenant_status_idx
  ON awcms_domain_event_deliveries (tenant_id, status);
CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_tenant_consumer_idx
  ON awcms_domain_event_deliveries (tenant_id, consumer_name, status);
CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_replay_of_idx
  ON awcms_domain_event_deliveries (replay_of_delivery_id)
  WHERE replay_of_delivery_id IS NOT NULL;

ALTER TABLE awcms_domain_event_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_event_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_event_deliveries_tenant_isolation
  ON awcms_domain_event_deliveries
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. Generic per-consumer side-effect idempotency marker. `event_id`
-- intentionally has NO foreign key to `awcms_domain_events` — the marker
-- must remain valid even after a future retention/purge policy removes old
-- event rows; an FK would force lockstep purge of two independent
-- retention decisions.
CREATE TABLE IF NOT EXISTS awcms_domain_event_consumer_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  consumer_name text NOT NULL,
  event_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_domain_event_consumer_effects_identity_key
  ON awcms_domain_event_consumer_effects (tenant_id, consumer_name, event_id);

ALTER TABLE awcms_domain_event_consumer_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_event_consumer_effects FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_event_consumer_effects_tenant_isolation
  ON awcms_domain_event_consumer_effects
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 4. Per (tenant, consumer) pause/resume switch.
CREATE TABLE IF NOT EXISTS awcms_domain_event_consumer_state (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  consumer_name text NOT NULL,
  is_paused boolean NOT NULL DEFAULT false,
  paused_at timestamptz,
  paused_by uuid,
  paused_reason text,
  resumed_at timestamptz,
  resumed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer_name)
);

ALTER TABLE awcms_domain_event_consumer_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_event_consumer_state FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_event_consumer_state_tenant_isolation
  ON awcms_domain_event_consumer_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 5. Append-only replay audit trail — never UPDATEd/DELETEd by application
-- code.
CREATE TABLE IF NOT EXISTS awcms_domain_event_replays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  original_delivery_id uuid NOT NULL REFERENCES awcms_domain_event_deliveries (id),
  replay_delivery_id uuid NOT NULL REFERENCES awcms_domain_event_deliveries (id),
  requested_by uuid NOT NULL,
  reason text NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_domain_event_replays_reason_length_check
    CHECK (char_length(reason) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS awcms_domain_event_replays_original_idx
  ON awcms_domain_event_replays (tenant_id, original_delivery_id);
CREATE INDEX IF NOT EXISTS awcms_domain_event_replays_replay_idx
  ON awcms_domain_event_replays (replay_delivery_id);

ALTER TABLE awcms_domain_event_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_event_replays FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_event_replays_tenant_isolation
  ON awcms_domain_event_replays
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Reference read-model projection consumer's denormalized rollup — a
-- read-optimized aggregate, NOT a source of truth (the outbox itself is).
-- `event_count` is maintained via `INSERT ... ON CONFLICT (tenant_id,
-- activity_date, event_type) DO UPDATE SET event_count = event_count + 1`
-- guarded by the SAME `applyConsumerEffectOnce` idempotency marker every
-- other consumer uses, so a redelivered event increments at most once.
CREATE TABLE IF NOT EXISTS awcms_domain_event_activity_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  activity_date date NOT NULL,
  event_type text NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_domain_event_activity_daily_count_check
    CHECK (event_count >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_domain_event_activity_daily_identity_key
  ON awcms_domain_event_activity_daily (tenant_id, activity_date, event_type);

ALTER TABLE awcms_domain_event_activity_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_domain_event_activity_daily FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_domain_event_activity_daily_tenant_isolation
  ON awcms_domain_event_activity_daily
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Permission catalog seed (matches `module.ts`'s `permissions`).
INSERT INTO awcms_permissions (module_key, activity_code, action, description)
VALUES
  ('domain_event_runtime', 'events', 'read', 'Read domain event outbox entries (redacted payload projections only)'),
  ('domain_event_runtime', 'deliveries', 'read', 'Read domain event consumer delivery/attempt status, including dead-lettered deliveries'),
  ('domain_event_runtime', 'deliveries', 'replay', 'Replay a dead-lettered domain event delivery to a registered consumer'),
  ('domain_event_runtime', 'consumers', 'read', 'Read the domain event consumer registry and pause state'),
  ('domain_event_runtime', 'consumers', 'manage', 'Pause or resume a domain event consumer')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;
