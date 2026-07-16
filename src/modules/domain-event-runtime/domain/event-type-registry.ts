/**
 * The versioned catalog of event types this runtime is aware of ("runtime
 * registry and AsyncAPI event types/versions pass bidirectional parity
 * checks"). `appendDomainEvent` (`application/append-domain-event.ts`)
 * REFUSES to persist an event whose `(eventType, eventVersion)` is not
 * listed here — this is the mechanism (not just documentation) that stops
 * "event types/versions silently drifting" from the published AsyncAPI
 * contract: a new/changed event type must be added HERE first (reviewed
 * source code), which `tests/domain-event-registry-parity.test.ts` then
 * cross-checks against `asyncapi/awcms-domain-events.asyncapi.yaml` in both
 * directions (registry entry without a channel = fail; a channel this
 * runtime's own consumer registry subscribes to without a matching entry
 * here = fail).
 *
 * Scope note: this module ships exactly one registered event type — a
 * self-contained reference/example (`sample.recorded`) used to exercise and
 * prove the outbox/dispatcher/ordering/retry/DLQ/replay mechanism
 * end-to-end. Future producer modules add their OWN entries here (and their
 * own `module.ts` `events.publishes` entries, and their own AsyncAPI
 * channels) when they start calling `appendDomainEvent`.
 */
export type RegisteredDomainEventType = {
  eventType: string;
  eventVersion: string;
  description: string;
};

export const SAMPLE_RECORDED_EVENT_TYPE =
  "awcms.domain-event-runtime.sample.recorded";
export const SAMPLE_RECORDED_EVENT_VERSION = "1.0";

export const DOMAIN_EVENT_TYPE_REGISTRY: readonly RegisteredDomainEventType[] =
  [
    {
      eventType: SAMPLE_RECORDED_EVENT_TYPE,
      eventVersion: SAMPLE_RECORDED_EVENT_VERSION,
      description:
        "Reference/example event type used to exercise the domain-event-runtime outbox, dispatcher, ordering, retry/backoff, dead-letter, and replay mechanism end-to-end. Real producer modules publish their OWN event types the same way, via appendDomainEvent — this one is intentionally self-contained rather than tied to another module's business logic in this foundation module."
    }
  ];

export function isRegisteredDomainEventType(
  eventType: string,
  eventVersion: string
): boolean {
  return DOMAIN_EVENT_TYPE_REGISTRY.some(
    (entry) =>
      entry.eventType === eventType && entry.eventVersion === eventVersion
  );
}
