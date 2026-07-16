/**
 * Static consumer registry types ("a static consumer registry owned by
 * reviewed source code"). Concrete registrations live in
 * `infrastructure/consumer-registry.ts` — a plain array, not a runtime
 * `registerConsumer()` call, so the full set of consumers for any event
 * type is always knowable from source code alone (grep/read), never from
 * database state or a dynamic plugin mechanism.
 */

/** What a consumer handler receives — a narrowed, already-typed projection of the joined `awcms_domain_events` row, never the raw DB row shape. */
export type DomainEventForHandler = {
  id: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  orderKey: string;
  correlationId: string | null;
  causationId: string | null;
  producerModule: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  recordedAt: Date;
};

export type DomainEventConsumerHandlerContext = {
  tenantId: string;
  correlationId: string;
};

/**
 * `tx` is a tenant-scoped transaction (same one the delivery's own
 * claim/finalize runs in — see `application/dispatch-domain-events.ts`'s
 * doc comment for why this is safe for a same-process, DB-only handler and
 * what would need to change for a future out-of-transaction/broker-backed
 * consumer). A handler MUST be idempotent by `event.id` — the dispatcher
 * guarantees at-LEAST-once delivery per consumer, never exactly-once. Use
 * `application/consumer-effect.ts`'s `applyConsumerEffectOnce` to get this
 * for free.
 */
export type DomainEventConsumerHandler = (
  tx: Bun.SQL,
  event: DomainEventForHandler,
  ctx: DomainEventConsumerHandlerContext
) => Promise<void>;

export type DomainEventConsumerDefinition = {
  /** Stable identifier — used as the delivery row's `consumer_name`, the idempotency-marker key, the pause/resume key, and the metrics label. Changing it orphans any already-pending delivery rows for the old name — treat it as a durable identifier, not a display label. Convention: `<owning module>.<role>`, e.g. `"logging.sample_event_audit_projector"`. */
  name: string;
  description: string;
  /** Every event type this consumer wants delivered. An event's delivery rows are created ONCE, at publish time, from this list (`application/append-domain-event.ts`) — there is no dynamic/wildcard subscription (deliberate scope limit). */
  eventTypes: readonly string[];
  /** Event VERSIONS (per event type) this consumer's handler knows how to interpret. An event published with a version not in this list still gets a delivery row (so the gap is visible/auditable) but the dispatcher transitions it straight to `skipped` without ever calling `handler`. */
  eventVersions: readonly string[];
  /** Defaults to 8 (`DEFAULT_CONSUMER_MAX_ATTEMPTS`) if omitted. */
  maxAttempts?: number;
  handler: DomainEventConsumerHandler;
};

export const DEFAULT_CONSUMER_MAX_ATTEMPTS = 8;
