import { redactEventPayloadForResponse } from "../domain/payload-redaction";

/**
 * Admin/API read surface for the outbox and delivery tables — every payload
 * leaving this file is redacted ("dead-letter inspection returns safe
 * metadata and redacted payload projections only", applied here to every
 * payload-carrying response, not only DLQ rows). Consumers' own `handler`s
 * never go through this file — they read the raw row directly in
 * `application/dispatch-domain-events.ts`, which is correct/necessary (a
 * handler needs real data to do its job).
 *
 * Optional filters below use the `(${value}::text IS NULL OR column =
 * ${value})` shape — a fully parameterized way to make a WHERE clause
 * conditional without building dynamic SQL text, so no query here needs
 * `sql.unsafe()`.
 */

export type DomainEventView = {
  id: string;
  eventSequence: number;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number | null;
  orderKey: string;
  correlationId: string | null;
  causationId: string | null;
  producerModule: string;
  schemaRef: string | null;
  payload: Record<string, unknown> | undefined;
  occurredAt: Date;
  recordedAt: Date;
};

type DomainEventRow = {
  id: string;
  event_sequence: string | number;
  event_type: string;
  event_version: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number | null;
  order_key: string;
  correlation_id: string | null;
  causation_id: string | null;
  producer_module: string;
  schema_ref: string | null;
  payload: Record<string, unknown>;
  occurred_at: Date;
  recorded_at: Date;
};

function toEventView(row: DomainEventRow): DomainEventView {
  return {
    id: row.id,
    eventSequence: Number(row.event_sequence),
    eventType: row.event_type,
    eventVersion: row.event_version,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    aggregateVersion: row.aggregate_version,
    orderKey: row.order_key,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    producerModule: row.producer_module,
    schemaRef: row.schema_ref,
    payload: redactEventPayloadForResponse(row.payload),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at
  };
}

export type ListDomainEventsOptions = {
  eventType?: string;
  aggregateType?: string;
  aggregateId?: string;
  limit?: number;
};

export async function listDomainEvents(
  tx: Bun.SQL,
  tenantId: string,
  options: ListDomainEventsOptions = {}
): Promise<DomainEventView[]> {
  const limit = Math.min(options.limit ?? 100, 200);
  const eventType = options.eventType ?? null;
  const aggregateType = options.aggregateType ?? null;
  const aggregateId = options.aggregateId ?? null;

  const rows = (await tx`
    SELECT id, event_sequence, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, order_key, correlation_id, causation_id, producer_module, schema_ref,
      payload, occurred_at, recorded_at
    FROM awcms_domain_events
    WHERE tenant_id = ${tenantId}
      AND (${eventType}::text IS NULL OR event_type = ${eventType})
      AND (${aggregateType}::text IS NULL OR aggregate_type = ${aggregateType})
      AND (${aggregateId}::uuid IS NULL OR aggregate_id = ${aggregateId})
    ORDER BY event_sequence DESC
    LIMIT ${limit}
  `) as DomainEventRow[];

  return rows.map(toEventView);
}

export async function fetchDomainEventById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<DomainEventView | null> {
  const rows = (await tx`
    SELECT id, event_sequence, event_type, event_version, aggregate_type, aggregate_id,
      aggregate_version, order_key, correlation_id, causation_id, producer_module, schema_ref,
      payload, occurred_at, recorded_at
    FROM awcms_domain_events
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as DomainEventRow[];

  const row = rows[0];
  return row ? toEventView(row) : null;
}

export type DomainEventDeliveryView = {
  id: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  orderKey: string;
  consumerName: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastRetryClassification: string | null;
  deliveredAt: Date | null;
  deadLetterAt: Date | null;
  deadLetterReason: string | null;
  replayOfDeliveryId: string | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
  event?: DomainEventView;
};

type DomainEventDeliveryRow = {
  id: string;
  event_id: string;
  event_type: string;
  event_version: string;
  order_key: string;
  consumer_name: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_retry_classification: string | null;
  delivered_at: Date | null;
  dead_letter_at: Date | null;
  dead_letter_reason: string | null;
  replay_of_delivery_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function toDeliveryView(row: DomainEventDeliveryRow): DomainEventDeliveryView {
  return {
    id: row.id,
    eventId: row.event_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    orderKey: row.order_key,
    consumerName: row.consumer_name,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    // Already redacted by `sanitizeErrorForLog`/`redactSecretsInText` at
    // write time (`application/dispatch-domain-events.ts`) — no further
    // masking needed here.
    lastErrorMessage: row.last_error_message,
    lastRetryClassification: row.last_retry_classification,
    deliveredAt: row.delivered_at,
    deadLetterAt: row.dead_letter_at,
    deadLetterReason: row.dead_letter_reason,
    replayOfDeliveryId: row.replay_of_delivery_id,
    correlationId: row.correlation_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export type ListDomainEventDeliveriesOptions = {
  status?: string;
  consumerName?: string;
  eventType?: string;
  limit?: number;
};

export async function listDomainEventDeliveries(
  tx: Bun.SQL,
  tenantId: string,
  options: ListDomainEventDeliveriesOptions = {}
): Promise<DomainEventDeliveryView[]> {
  const limit = Math.min(options.limit ?? 100, 200);
  const status = options.status ?? null;
  const consumerName = options.consumerName ?? null;
  const eventType = options.eventType ?? null;

  const rows = (await tx`
    SELECT id, event_id, event_type, event_version, order_key, consumer_name, status,
      attempt_count, max_attempts, next_attempt_at, last_error_code, last_error_message,
      last_retry_classification, delivered_at, dead_letter_at, dead_letter_reason,
      replay_of_delivery_id, correlation_id, created_at, updated_at
    FROM awcms_domain_event_deliveries
    WHERE tenant_id = ${tenantId}
      AND (${status}::text IS NULL OR status = ${status})
      AND (${consumerName}::text IS NULL OR consumer_name = ${consumerName})
      AND (${eventType}::text IS NULL OR event_type = ${eventType})
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as DomainEventDeliveryRow[];

  return rows.map(toDeliveryView);
}

export async function fetchDomainEventDeliveryById(
  tx: Bun.SQL,
  tenantId: string,
  id: string
): Promise<DomainEventDeliveryView | null> {
  const rows = (await tx`
    SELECT id, event_id, event_type, event_version, order_key, consumer_name, status,
      attempt_count, max_attempts, next_attempt_at, last_error_code, last_error_message,
      last_retry_classification, delivered_at, dead_letter_at, dead_letter_reason,
      replay_of_delivery_id, correlation_id, created_at, updated_at
    FROM awcms_domain_event_deliveries
    WHERE tenant_id = ${tenantId} AND id = ${id}
  `) as DomainEventDeliveryRow[];

  const row = rows[0];
  if (!row) return null;

  const view = toDeliveryView(row);
  const event = await fetchDomainEventById(tx, tenantId, row.event_id);

  return { ...view, event: event ?? undefined };
}
