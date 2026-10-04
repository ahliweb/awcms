/**
 * `tax` domain-event type/version constants (ADR-0127).
 *
 * Kept in `domain/` with no imports so the producers, the
 * `domain_event_runtime` registry and the AsyncAPI parity gate all reference
 * the same literals. The matching entries live in
 * `domain-event-runtime/domain/event-type-registry.ts` and in
 * `asyncapi/awcms-domain-events.asyncapi.yaml`.
 *
 * Payloads carry identifiers, codes and decimal-string totals only. No customer
 * data of any kind ever reaches this module in the first place: a document is an
 * opaque reference.
 */
export const TAX_EVENT_VERSION = "1.0";

export const TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE =
  "awcms.tax.rule_version.published";
export const TAX_SNAPSHOT_FINALISED_EVENT_TYPE = "awcms.tax.snapshot.finalised";
export const TAX_SNAPSHOT_REVERSED_EVENT_TYPE = "awcms.tax.snapshot.reversed";

export const TAX_RULE_VERSION_AGGREGATE_TYPE = "tax.rule_version";
export const TAX_SNAPSHOT_AGGREGATE_TYPE = "tax.snapshot";
