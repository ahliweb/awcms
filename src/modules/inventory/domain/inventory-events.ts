/**
 * `inventory` domain-event type/version constants (Issue #887, ADR-0126).
 *
 * Kept in `domain/` with no imports so the producer, the
 * `domain_event_runtime` registry and the AsyncAPI parity gate all reference
 * the same literals — the shape `comments/domain/comment-events.ts` set. The
 * matching registry entries live in
 * `domain-event-runtime/domain/event-type-registry.ts` and the channels in
 * `asyncapi/awcms-domain-events.asyncapi.yaml`; they are kept in sync by
 * convention plus the parity gate, deliberately NOT by importing this module
 * from the foundation runtime.
 *
 * Payloads carry opaque references and decimal-string quantities only — never a
 * note, an actor's name, or anything that identifies a person.
 */
export const INVENTORY_EVENT_VERSION = "1.0";

export const INVENTORY_MOVEMENT_POSTED_EVENT_TYPE =
  "awcms.inventory.movement.posted";
export const INVENTORY_STOCK_LOW_EVENT_TYPE = "awcms.inventory.stock.low";

export const INVENTORY_MOVEMENT_AGGREGATE_TYPE = "inventory.movement";
export const INVENTORY_BALANCE_AGGREGATE_TYPE = "inventory.balance";
