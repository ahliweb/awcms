/**
 * Generic per-consumer side-effect idempotency helper, backed by
 * `awcms_domain_event_consumer_effects` ("duplicate delivery cannot
 * duplicate side effects; consumers must use event ID/idempotency"). Any
 * consumer `handler` (`domain/consumer-types.ts`) wraps its own side effect
 * in this — same `INSERT ... ON CONFLICT DO NOTHING RETURNING id` shape
 * `saveIdempotencyRecord` (`_shared/idempotency.ts`) uses for HTTP mutation
 * idempotency, applied here to the (consumer, event) pair instead of
 * (tenant, requestScope, idempotencyKey).
 *
 * Why this is needed IN ADDITION to `awcms_domain_event_deliveries`'s own
 * per-(event,consumer) uniqueness: that table's uniqueness prevents a
 * SECOND delivery ROW from ever being created for the same (event,
 * consumer) — but a delivery whose handler ran, then crashed before the
 * delivery row's own `status = 'delivered'` UPDATE committed, gets
 * legitimately RE-ATTEMPTED on the SAME row (still `pending`) — the marker
 * here is what makes that re-attempt's side effect a no-op instead of a
 * duplicate, since the delivery row's OWN state can't distinguish "never
 * ran" from "ran but crashed before finalizing."
 */
export async function applyConsumerEffectOnce(
  tx: Bun.SQL,
  tenantId: string,
  consumerName: string,
  eventId: string,
  sideEffect: () => Promise<void>
): Promise<{ applied: boolean }> {
  const rows = (await tx`
    INSERT INTO awcms_domain_event_consumer_effects
      (tenant_id, consumer_name, event_id)
    VALUES (${tenantId}, ${consumerName}, ${eventId})
    ON CONFLICT (tenant_id, consumer_name, event_id) DO NOTHING
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) {
    return { applied: false };
  }

  await sideEffect();

  return { applied: true };
}
