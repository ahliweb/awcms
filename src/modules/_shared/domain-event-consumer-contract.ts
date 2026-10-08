/**
 * Domain-event CONSUMER contract (ADR-0134, Issue #918).
 *
 * Pure types, deliberately in `_shared`: a module declares its consumers in its
 * OWN `module.ts` (`ModuleDescriptor.domainEventConsumers`), and the dependency
 * therefore points owner -> `domain_event_runtime` (the direction its
 * `dependencies` can truthfully declare). The runtime owns the delivery
 * machinery and builds its registry FROM the composed module list; it never
 * imports a consumer. Before ADR-0134 the arrow ran the other way, which is the
 * `domain_event_runtime -> reporting` import cycle `tests/module-boundary.test.ts`
 * used to carry as a documented exception, and the reason a downstream repo had
 * to edit an upstream file to add a consumer.
 *
 * TRUSTED CODE-ONLY METADATA, like every descriptor type: declared by reviewed
 * source, never tenant/request-controlled, never database-driven.
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
 * `tx` is a tenant-scoped transaction (the same one the delivery's own
 * claim/finalize runs in — see `domain-event-runtime/application/
 * dispatch-domain-events.ts`). Delivery is at-LEAST-once per consumer, never
 * exactly-once: emitted-once is NOT handled-once.
 */
export type DomainEventConsumerHandler = (
  tx: Bun.SQL,
  event: DomainEventForHandler,
  ctx: DomainEventConsumerHandlerContext
) => Promise<void>;

/**
 * How a declared consumer is protected against a redelivered event.
 *
 * - `"runtime_effect_once"` (the default, and the only one that needs no
 *   justification): the runtime wraps `handle` in `applyConsumerEffectOnce`,
 *   keyed `(tenant, consumer name, event id)`. A consumer that declares this
 *   CANNOT forget the guard, because it never calls it — `handle` is the side
 *   effect, not the handler.
 * - `"self_managed"`: `handle` is called as-is and owns its idempotency (a
 *   natural-key upsert, its own inbox table, an effect that is a pure function
 *   of the event). Requires `idempotencyRationale`, which a reviewer can
 *   disagree with — the gate refuses an empty one.
 */
export type DomainEventConsumerIdempotency =
  "runtime_effect_once" | "self_managed";

export type ModuleDomainEventConsumer = {
  /**
   * Globally unique across the composed registry. It is the delivery row's
   * `consumer_name`, the effect-ledger key, the pause/resume key and the metrics
   * label, so RENAMING one orphans its pending deliveries and RE-RUNS its
   * effects: treat it as a durable identifier. Shape `<segment>.<segment>`,
   * snake_case; by convention `<owning module>.<role>`.
   */
  name: string;
  description: string;
  /** Every event type this consumer wants delivered. Each must be published (`events.publishes`) by some module in the composed registry — a consumer of an event nobody declares can never receive anything. Delivery rows are fanned out ONCE at publish time from this list; there is no wildcard subscription. */
  eventTypes: readonly string[];
  /** Event versions `handle` knows how to interpret. A published version not listed still gets a delivery row, which the dispatcher moves straight to `skipped` without calling `handle`. */
  eventVersions: readonly string[];
  /** Defaults to `DEFAULT_CONSUMER_MAX_ATTEMPTS` (8). Positive integer. */
  maxAttempts?: number;
  /** Defaults to `"runtime_effect_once"`. */
  idempotency?: DomainEventConsumerIdempotency;
  /** Required when `idempotency` is `"self_managed"`: WHY a redelivery cannot duplicate the effect. */
  idempotencyRationale?: string;
  /**
   * Under `"runtime_effect_once"` this is the SIDE EFFECT (it runs at most once
   * per (tenant, consumer, event) unless it throws, in which case the whole
   * delivery transaction rolls back — marker included — and is retried). Under
   * `"self_managed"` it is the whole handler.
   *
   * Prefer a lazy `await import("./application/...")` inside the body: a
   * descriptor is loaded by everything that calls `listModules()`, and a static
   * import here would drag the module's database code into all of them.
   */
  handle: DomainEventConsumerHandler;
};
