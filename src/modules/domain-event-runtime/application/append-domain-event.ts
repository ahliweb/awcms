import { deriveOrderKey, validateDomainEventPayload } from "../domain/envelope";
import { isRegisteredDomainEventType } from "../domain/event-type-registry";
import { getConsumersForEventType } from "../infrastructure/consumer-registry";

/**
 * The outbox PRODUCER ("source state and outbox record commit atomically").
 * `tx` MUST be the caller's own business transaction (`withTenant`'s
 * callback, or a nested composition of the same) — this function performs
 * ONLY plain DB writes (no network/provider call, ADR-0006), so calling it
 * inside the SAME transaction as the source state change it describes is
 * what makes "rolled-back source transactions produce no dispatchable
 * event" true by construction: if the caller's transaction rolls back for
 * ANY reason (including one raised AFTER this call returns), the event row
 * (and every delivery row this call created) rolls back with it — there is
 * no separate commit for this function to hold open.
 */
export type AppendDomainEventInput = {
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  /** Optional — envelope requires aggregate type/id/version OR an ordering key, not necessarily both. */
  aggregateVersion?: number;
  /** Defaults to `deriveOrderKey(aggregateType, aggregateId)` — see that function's doc comment for when to override. */
  orderKey?: string;
  correlationId?: string | null;
  causationId?: string | null;
  /** The publishing module's own `ModuleDescriptor.key` — never inferred, always passed explicitly by the caller (keeps this function free of any module-registry dependency). */
  producerModule: string;
  /** Optional pointer into the AsyncAPI contract (e.g. the channel name) — documentation only, not resolved/validated here. */
  schemaRef?: string | null;
  actorTenantUserId?: string | null;
  actorProfileId?: string | null;
  payload: Record<string, unknown>;
  /** Defaults to `now()` — pass explicitly only when the domain-meaningful occurrence time genuinely differs from when this outbox row is recorded. */
  occurredAt?: Date;
};

export type AppendDomainEventResult = {
  eventId: string;
  eventSequence: number;
  deliveriesCreated: number;
  skippedConsumers: { consumerName: string; reason: string }[];
};

export class InvalidDomainEventPayloadError extends Error {
  constructor(errors: string[]) {
    super(`Invalid domain event payload: ${errors.join("; ")}`);
    this.name = "InvalidDomainEventPayloadError";
  }
}

export class UnregisteredDomainEventTypeError extends Error {
  constructor(eventType: string, eventVersion: string) {
    super(
      `Event type "${eventType}" version "${eventVersion}" is not listed in DOMAIN_EVENT_TYPE_REGISTRY — register it in domain/event-type-registry.ts (and the matching AsyncAPI channel) before publishing.`
    );
    this.name = "UnregisteredDomainEventTypeError";
  }
}

type DomainEventRow = { id: string; event_sequence: string | number };

export async function appendDomainEvent(
  tx: Bun.SQL,
  tenantId: string,
  input: AppendDomainEventInput
): Promise<AppendDomainEventResult> {
  const validation = validateDomainEventPayload(input.payload);

  if (!validation.valid) {
    throw new InvalidDomainEventPayloadError(validation.errors);
  }

  if (!isRegisteredDomainEventType(input.eventType, input.eventVersion)) {
    throw new UnregisteredDomainEventTypeError(
      input.eventType,
      input.eventVersion
    );
  }

  const orderKey =
    input.orderKey ?? deriveOrderKey(input.aggregateType, input.aggregateId);
  const occurredAt = input.occurredAt ?? new Date();

  const eventRows = (await tx`
    INSERT INTO awcms_domain_events
      (tenant_id, event_type, event_version, aggregate_type, aggregate_id,
       aggregate_version, order_key, correlation_id, causation_id,
       producer_module, schema_ref, actor_tenant_user_id, actor_profile_id,
       payload, occurred_at)
    VALUES (
      ${tenantId}, ${input.eventType}, ${input.eventVersion}, ${input.aggregateType},
      ${input.aggregateId}, ${input.aggregateVersion ?? null}, ${orderKey},
      ${input.correlationId ?? null}, ${input.causationId ?? null}, ${input.producerModule},
      ${input.schemaRef ?? null}, ${input.actorTenantUserId ?? null}, ${input.actorProfileId ?? null},
      ${input.payload}, ${occurredAt}
    )
    RETURNING id, event_sequence
  `) as DomainEventRow[];

  const event = eventRows[0]!;
  const eventId = event.id;
  const eventSequence = Number(event.event_sequence);

  const matchingConsumers = getConsumersForEventType(input.eventType);
  let deliveriesCreated = 0;
  const skippedConsumers: { consumerName: string; reason: string }[] = [];

  for (const consumer of matchingConsumers) {
    if (!consumer.eventVersions.includes(input.eventVersion)) {
      skippedConsumers.push({
        consumerName: consumer.name,
        reason: `Consumer does not declare support for event version "${input.eventVersion}".`
      });
      continue;
    }

    await tx`
      INSERT INTO awcms_domain_event_deliveries
        (tenant_id, event_id, event_sequence, event_type, event_version,
         order_key, consumer_name, max_attempts, correlation_id)
      VALUES (
        ${tenantId}, ${eventId}, ${eventSequence}, ${input.eventType}, ${input.eventVersion},
        ${orderKey}, ${consumer.name}, ${consumer.maxAttempts ?? 8}, ${input.correlationId ?? null}
      )
      ON CONFLICT (tenant_id, event_id, consumer_name) WHERE replay_of_delivery_id IS NULL
      DO NOTHING
    `;
    deliveriesCreated += 1;
  }

  return { eventId, eventSequence, deliveriesCreated, skippedConsumers };
}
