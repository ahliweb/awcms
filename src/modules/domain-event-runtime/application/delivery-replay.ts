import { recordAuditEvent } from "../../logging/application/audit-log";
import { getConsumerByName } from "../infrastructure/consumer-registry";
import {
  fetchDomainEventDeliveryById,
  type DomainEventDeliveryView
} from "./domain-event-directory";

/**
 * Operator-safe replay ("replay is permission-gated, reason-required,
 * idempotent, and audited, and cannot replay an incompatible schema
 * silently"). Permission-gating and `Idempotency-Key` handling both live at
 * the ROUTE layer
 * (`src/pages/api/v1/domain-events/deliveries/[id]/replay.ts`), matching
 * every other high-risk mutation in this repo (the idempotency guarantee
 * comes from the standard `Idempotency-Key` + `awcms_idempotency_keys`
 * wrapper around this function, not from this function being independently
 * idempotent). `reason` is validated as non-empty by the DB CHECK
 * constraint on `awcms_domain_event_replays` (migration 009) as a backstop;
 * the route also validates it explicitly for a clean 400 instead of a raw
 * constraint error.
 *
 * Only replays a `dead_letter` delivery — a `pending` delivery is already
 * eligible for ordinary dispatch (no replay needed), and a `delivered`/
 * `skipped` delivery replaying would duplicate a side effect that already
 * completed successfully (or was deliberately not applicable).
 */
export class DeliveryNotDeadLetteredError extends Error {
  constructor(deliveryId: string, currentStatus: string) {
    super(
      `Delivery "${deliveryId}" is not dead-lettered (current status: "${currentStatus}") — only dead-lettered deliveries can be replayed.`
    );
    this.name = "DeliveryNotDeadLetteredError";
  }
}

export class ReplaySchemaIncompatibleError extends Error {
  constructor(consumerName: string, eventVersion: string) {
    super(
      `Consumer "${consumerName}" no longer supports event version "${eventVersion}" — refusing to replay against an incompatible schema.`
    );
    this.name = "ReplaySchemaIncompatibleError";
  }
}

export class UnknownReplayConsumerError extends Error {
  constructor(consumerName: string) {
    super(
      `"${consumerName}" is no longer a registered domain event consumer — cannot replay.`
    );
    this.name = "UnknownReplayConsumerError";
  }
}

export async function replayDomainEventDelivery(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  deliveryId: string,
  reason: string,
  correlationId?: string
): Promise<DomainEventDeliveryView | null> {
  const original = await fetchDomainEventDeliveryById(tx, tenantId, deliveryId);

  if (!original) {
    return null;
  }

  if (original.status !== "dead_letter") {
    throw new DeliveryNotDeadLetteredError(deliveryId, original.status);
  }

  const consumer = getConsumerByName(original.consumerName);

  if (!consumer) {
    throw new UnknownReplayConsumerError(original.consumerName);
  }

  if (!consumer.eventVersions.includes(original.eventVersion)) {
    throw new ReplaySchemaIncompatibleError(
      original.consumerName,
      original.eventVersion
    );
  }

  const insertedRows = (await tx`
    INSERT INTO awcms_domain_event_deliveries
      (tenant_id, event_id, event_sequence, event_type, event_version, order_key,
       consumer_name, status, max_attempts, replay_of_delivery_id, correlation_id)
    SELECT tenant_id, event_id, event_sequence, event_type, event_version, order_key,
      consumer_name, 'pending', ${consumer.maxAttempts ?? 8}, id, ${correlationId ?? null}
    FROM awcms_domain_event_deliveries
    WHERE tenant_id = ${tenantId} AND id = ${deliveryId}
    RETURNING id
  `) as { id: string }[];

  const replayDeliveryId = insertedRows[0]!.id;

  await tx`
    INSERT INTO awcms_domain_event_replays
      (tenant_id, original_delivery_id, replay_delivery_id, requested_by, reason, correlation_id)
    VALUES (${tenantId}, ${deliveryId}, ${replayDeliveryId}, ${actorTenantUserId}, ${reason}, ${correlationId ?? null})
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: "domain_event_runtime",
    action: "domain_event_runtime.delivery.replayed",
    resourceType: "domain_event_delivery",
    resourceId: deliveryId,
    severity: "warning",
    message: `Domain event delivery replayed for consumer "${original.consumerName}".`,
    attributes: {
      reason,
      replayDeliveryId,
      consumerName: original.consumerName
    },
    correlationId
  });

  const replayView = await fetchDomainEventDeliveryById(
    tx,
    tenantId,
    replayDeliveryId
  );

  return replayView;
}
