import { redactSensitiveAttributes } from "../../_shared/redaction";

/**
 * Read-time masking for admin/API inspection responses ("dead-letter
 * inspection returns safe metadata and redacted payload projections only" —
 * applied uniformly to EVERY payload inspection surface this module
 * exposes, not just DLQ rows).
 *
 * Distinct from `envelope.ts`'s `validateDomainEventPayload`: that function
 * REJECTS a payload outright at write time if it contains a secret-shaped
 * key/value (a credential should never be persisted at all). This function
 * instead MASKS legitimate business data that happens to sit behind a
 * sensitive-looking key name (e.g. a customer's `email` in a payload a real
 * consumer genuinely needs to do its job) — the raw, unredacted payload is
 * still what `application/dispatch-domain-events.ts` hands to a consumer
 * `handler`; only the HTTP response built by
 * `application/domain-event-directory.ts` for human/API inspection goes
 * through this.
 */
export function redactEventPayloadForResponse(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> | undefined {
  return redactSensitiveAttributes(payload ?? undefined);
}
