import { recordAuditEvent } from "../../logging/application/audit-log";
import {
  DOMAIN_EVENT_CONSUMERS,
  getConsumerByName
} from "../infrastructure/consumer-registry";

/**
 * Consumer registry visibility + pause/resume ("maximum attempts,
 * dead-letter state, operator-safe replay, and pause/resume"). Registered
 * consumers themselves are STATIC (source code,
 * `infrastructure/consumer-registry.ts`) — this module only manages the
 * per-tenant runtime PAUSE FLAG (`awcms_domain_event_consumer_state`),
 * checked by `application/dispatch-domain-events.ts` before claiming any
 * delivery for a given (tenant, consumer).
 */

const MODULE_KEY = "domain_event_runtime";

export type DomainEventConsumerView = {
  name: string;
  description: string;
  eventTypes: readonly string[];
  eventVersions: readonly string[];
  maxAttempts: number;
  isPaused: boolean;
  pausedAt: Date | null;
  pausedReason: string | null;
  pendingCount: number;
  deadLetterCount: number;
};

type ConsumerStateRow = {
  is_paused: boolean;
  paused_at: Date | null;
  paused_reason: string | null;
};

type BacklogCountRow = { status: string; row_count: string | number };

export async function listConsumerStates(
  tx: Bun.SQL,
  tenantId: string
): Promise<DomainEventConsumerView[]> {
  const stateRows = (await tx`
    SELECT consumer_name, is_paused, paused_at, paused_reason
    FROM awcms_domain_event_consumer_state
    WHERE tenant_id = ${tenantId}
  `) as Array<ConsumerStateRow & { consumer_name: string }>;

  const stateByName = new Map(stateRows.map((row) => [row.consumer_name, row]));

  const backlogRows = (await tx`
    SELECT consumer_name, status, count(*)::int AS row_count
    FROM awcms_domain_event_deliveries
    WHERE tenant_id = ${tenantId} AND status IN ('pending', 'dead_letter')
    GROUP BY consumer_name, status
  `) as Array<BacklogCountRow & { consumer_name: string }>;

  const backlogByName = new Map<
    string,
    { pending: number; deadLetter: number }
  >();

  for (const row of backlogRows) {
    const entry = backlogByName.get(row.consumer_name) ?? {
      pending: 0,
      deadLetter: 0
    };

    if (row.status === "pending") entry.pending = Number(row.row_count);
    else if (row.status === "dead_letter")
      entry.deadLetter = Number(row.row_count);

    backlogByName.set(row.consumer_name, entry);
  }

  return DOMAIN_EVENT_CONSUMERS.map((consumer) => {
    const state = stateByName.get(consumer.name);
    const backlog = backlogByName.get(consumer.name) ?? {
      pending: 0,
      deadLetter: 0
    };

    return {
      name: consumer.name,
      description: consumer.description,
      eventTypes: consumer.eventTypes,
      eventVersions: consumer.eventVersions,
      maxAttempts: consumer.maxAttempts ?? 8,
      isPaused: state?.is_paused ?? false,
      pausedAt: state?.paused_at ?? null,
      pausedReason: state?.paused_reason ?? null,
      pendingCount: backlog.pending,
      deadLetterCount: backlog.deadLetter
    };
  });
}

export class UnknownDomainEventConsumerError extends Error {
  constructor(name: string) {
    super(`"${name}" is not a registered domain event consumer.`);
    this.name = "UnknownDomainEventConsumerError";
  }
}

export async function pauseConsumer(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  consumerName: string,
  reason: string,
  correlationId?: string
): Promise<void> {
  if (!getConsumerByName(consumerName)) {
    throw new UnknownDomainEventConsumerError(consumerName);
  }

  await tx`
    INSERT INTO awcms_domain_event_consumer_state
      (tenant_id, consumer_name, is_paused, paused_at, paused_by, paused_reason, updated_at)
    VALUES (${tenantId}, ${consumerName}, true, now(), ${actorTenantUserId}, ${reason}, now())
    ON CONFLICT (tenant_id, consumer_name) DO UPDATE SET
      is_paused = true, paused_at = now(), paused_by = ${actorTenantUserId},
      paused_reason = ${reason}, updated_at = now()
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: MODULE_KEY,
    action: "domain_event_runtime.consumer.paused",
    resourceType: "domain_event_consumer",
    resourceId: consumerName,
    severity: "warning",
    message: `Domain event consumer "${consumerName}" paused.`,
    attributes: { reason },
    correlationId
  });
}

export async function resumeConsumer(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  consumerName: string,
  correlationId?: string
): Promise<void> {
  if (!getConsumerByName(consumerName)) {
    throw new UnknownDomainEventConsumerError(consumerName);
  }

  await tx`
    INSERT INTO awcms_domain_event_consumer_state
      (tenant_id, consumer_name, is_paused, resumed_at, resumed_by, updated_at)
    VALUES (${tenantId}, ${consumerName}, false, now(), ${actorTenantUserId}, now())
    ON CONFLICT (tenant_id, consumer_name) DO UPDATE SET
      is_paused = false, resumed_at = now(), resumed_by = ${actorTenantUserId}, updated_at = now()
  `;

  await recordAuditEvent(tx, {
    tenantId,
    actorTenantUserId,
    moduleKey: MODULE_KEY,
    action: "domain_event_runtime.consumer.resumed",
    resourceType: "domain_event_consumer",
    resourceId: consumerName,
    severity: "info",
    message: `Domain event consumer "${consumerName}" resumed.`,
    correlationId
  });
}
