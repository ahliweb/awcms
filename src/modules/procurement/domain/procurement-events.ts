/**
 * `procurement` domain-event type/version constants (Issue #888, ADR-0128).
 *
 * Kept in `domain/` with no imports so the producer, the `domain_event_runtime`
 * registry and the AsyncAPI parity gate reference the same literals — the shape
 * `inventory/domain/inventory-events.ts` set. Payloads carry opaque ids,
 * decimal-string quantities and costs only — never a supplier name, an
 * identifier, a note or a reason.
 */
export const PROCUREMENT_EVENT_VERSION = "1.0";

export const PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE =
  "awcms.procurement.document.finalised";
export const PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE =
  "awcms.procurement.document.reversed";

export const PROCUREMENT_DOCUMENT_AGGREGATE_TYPE = "procurement.document";
