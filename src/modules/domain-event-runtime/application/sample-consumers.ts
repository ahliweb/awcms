import { recordAuditEvent } from "../../logging/application/audit-log";
import type {
  DomainEventConsumerHandlerContext,
  DomainEventForHandler
} from "../domain/consumer-types";

/**
 * The side effects of this module's two reference consumers. They are declared
 * in `module.ts` (`domainEventConsumers`, ADR-0134) and loaded lazily from
 * there, so the descriptor stays import-light. Neither calls
 * `applyConsumerEffectOnce`: both declare `runtime_effect_once`, which makes the
 * registry wrap them — the guard cannot be forgotten by a function that never
 * sees it.
 */

/**
 * Same-process CROSS-MODULE consumer: reacts to a domain event by calling
 * `logging`'s own public `recordAuditEvent` function (the same cross-module
 * call other modules already make directly — audit logging is foundational
 * infrastructure). Demonstrates real cross-module collaboration driven entirely
 * by the dispatcher.
 */
export async function projectSampleEventToAuditTrail(
  tx: Bun.SQL,
  event: DomainEventForHandler,
  ctx: DomainEventConsumerHandlerContext
): Promise<void> {
  await recordAuditEvent(tx, {
    tenantId: ctx.tenantId,
    moduleKey: "domain_event_runtime",
    action: "domain_event_runtime.sample.audit_projected",
    resourceType: "domain_event",
    resourceId: event.id,
    severity: "info",
    message: `Sample domain event projected to audit trail (aggregate ${event.aggregateType}:${event.aggregateId}).`,
    attributes: { eventType: event.eventType },
    correlationId: ctx.correlationId
  });
}

/**
 * Reference READ-MODEL PROJECTION consumer: maintains
 * `awcms_domain_event_activity_daily`, a small denormalized rollup owned
 * entirely by THIS module — it writes only this module's own table, so it
 * stays self-contained.
 */
export async function applyActivityRollupIncrement(
  tx: Bun.SQL,
  event: DomainEventForHandler,
  ctx: DomainEventConsumerHandlerContext
): Promise<void> {
  const activityDate = event.occurredAt.toISOString().slice(0, 10);

  await tx`
    INSERT INTO awcms_domain_event_activity_daily
      (tenant_id, activity_date, event_type, event_count)
    VALUES (${ctx.tenantId}, ${activityDate}, ${event.eventType}, 1)
    ON CONFLICT (tenant_id, activity_date, event_type)
    DO UPDATE SET
      event_count = awcms_domain_event_activity_daily.event_count + 1,
      updated_at = now()
  `;
}
