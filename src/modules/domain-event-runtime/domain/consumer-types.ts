/**
 * Consumer types. The DECLARATION shape a module writes in its own descriptor
 * lives in `_shared/domain-event-consumer-contract.ts` (ADR-0134); this file
 * keeps the runtime's RESOLVED form (`DomainEventConsumerDefinition`), which the
 * registry builds from those declarations
 * (`infrastructure/consumer-registry.ts`) and the dispatcher executes. The
 * handler/event types are re-exported so existing imports keep working.
 */
export type {
  DomainEventConsumerHandler,
  DomainEventConsumerHandlerContext,
  DomainEventForHandler
} from "../../_shared/domain-event-consumer-contract";
import type { DomainEventConsumerHandler } from "../../_shared/domain-event-consumer-contract";

export type DomainEventConsumerDefinition = {
  /** The module whose descriptor declared this consumer (ADR-0134). */
  ownerModuleKey: string;
  /** Stable identifier — used as the delivery row's `consumer_name`, the idempotency-marker key, the pause/resume key, and the metrics label. Changing it orphans any already-pending delivery rows for the old name — treat it as a durable identifier, not a display label. Convention: `<owning module>.<role>`, e.g. `"logging.sample_event_audit_projector"`. */
  name: string;
  description: string;
  /** Every event type this consumer wants delivered. An event's delivery rows are created ONCE, at publish time, from this list (`application/append-domain-event.ts`) — there is no dynamic/wildcard subscription (deliberate scope limit). */
  eventTypes: readonly string[];
  /** Event VERSIONS (per event type) this consumer's handler knows how to interpret. An event published with a version not in this list still gets a delivery row (so the gap is visible/auditable) but the dispatcher transitions it straight to `skipped` without ever calling `handler`. */
  eventVersions: readonly string[];
  /** Defaults to 8 (`DEFAULT_CONSUMER_MAX_ATTEMPTS`) if omitted. */
  maxAttempts?: number;
  /** Already wrapped in `applyConsumerEffectOnce` for `runtime_effect_once` consumers (`infrastructure/consumer-registry.ts`). */
  handler: DomainEventConsumerHandler;
};

export const DEFAULT_CONSUMER_MAX_ATTEMPTS = 8;
