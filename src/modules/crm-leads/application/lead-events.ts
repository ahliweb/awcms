/**
 * The two writes every stage change makes together (Issue #1166, ADR-0153 L7,
 * L10): one append-only transition row and its outbox event(s), in the caller's
 * transaction. Nothing here locks: the caller holds the lead row `FOR UPDATE`,
 * which is what makes the next sequence number safe to compute.
 */
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  CRM_LEAD_AGGREGATE_TYPE,
  CRM_LEAD_LOST_EVENT_TYPE,
  CRM_LEAD_STAGE_CHANGED_EVENT_TYPE,
  CRM_LEADS_EVENT_VERSION,
  CRM_LEADS_MODULE_KEY,
  LOST_CATEGORIES,
  type StageCategory,
  type TransitionKind
} from "../domain/crm-leads-constants";
import {
  buildLeadLostPayload,
  buildStageChangedPayload,
  type StageChangeFacts
} from "../domain/crm-leads-events";

type Sql = Bun.SQL;

/** What every write path passes through so events and audit rows correlate. */
export type EmitContext = {
  correlationId: string | null;
  actorTenantUserId: string | null;
  idempotencyKey?: string | null;
};

export async function emitLeadEvent(
  tx: Sql,
  tenantId: string,
  emit: EmitContext,
  input: {
    eventType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
    occurredAt?: Date;
  }
): Promise<void> {
  await appendDomainEvent(tx, tenantId, {
    eventType: input.eventType,
    eventVersion: CRM_LEADS_EVENT_VERSION,
    aggregateType: CRM_LEAD_AGGREGATE_TYPE,
    aggregateId: input.aggregateId,
    producerModule: CRM_LEADS_MODULE_KEY,
    correlationId: emit.correlationId,
    actorTenantUserId: emit.actorTenantUserId,
    payload: input.payload,
    occurredAt: input.occurredAt ?? new Date()
  });
}

export type TransitionWrite = {
  leadId: string;
  kind: TransitionKind;
  pipelineId: string;
  revisionId: string;
  fromStageKey: string | null;
  fromCategory: StageCategory | null;
  toStageKey: string;
  toCategory: StageCategory;
  reason: string | null;
  actor: string | null;
  occurredAt: Date;
  idempotencyKey: string | null;
  correctsTransitionId?: string | null;
};

/**
 * Appends one transition row and publishes `lead.stage_changed` (and
 * `lead.lost` when the move ENTERS a lost/disqualified category). A `created`
 * row publishes nothing here: `lead.created` carries its facts.
 */
export async function appendLeadTransition(
  tx: Sql,
  tenantId: string,
  emit: EmitContext,
  write: TransitionWrite
): Promise<{ transitionId: string; sequence: number }> {
  const rows = (await tx`
    INSERT INTO awcms_crm_lead_transitions
      (tenant_id, lead_id, sequence, kind, pipeline_id, revision_id,
       from_stage_key, to_stage_key, from_category, to_category, reason,
       actor_tenant_user_id, occurred_at, idempotency_key, corrects_transition_id)
    SELECT ${tenantId}, ${write.leadId},
           COALESCE(MAX(sequence), 0) + 1,
           ${write.kind}, ${write.pipelineId}, ${write.revisionId},
           ${write.fromStageKey}, ${write.toStageKey}, ${write.fromCategory},
           ${write.toCategory}, ${write.reason}, ${write.actor},
           ${write.occurredAt}, ${write.idempotencyKey},
           ${write.correctsTransitionId ?? null}
    FROM awcms_crm_lead_transitions
    WHERE tenant_id = ${tenantId} AND lead_id = ${write.leadId}
    RETURNING id, sequence, recorded_at
  `) as { id: string; sequence: number; recorded_at: Date }[];
  const row = rows[0]!;

  if (write.kind !== "created") {
    const facts: StageChangeFacts = {
      leadId: write.leadId,
      pipelineId: write.pipelineId,
      revisionId: write.revisionId,
      transitionId: row.id,
      transitionKind: write.kind,
      fromStageKey: write.fromStageKey,
      toStageKey: write.toStageKey,
      fromCategory: write.fromCategory,
      toCategory: write.toCategory,
      occurredAt: write.occurredAt,
      recordedAt: row.recorded_at
    };

    await emitLeadEvent(tx, tenantId, emit, {
      eventType: CRM_LEAD_STAGE_CHANGED_EVENT_TYPE,
      aggregateId: write.leadId,
      payload: buildStageChangedPayload(facts)
    });

    if (
      LOST_CATEGORIES.includes(write.toCategory) &&
      write.fromCategory !== write.toCategory
    ) {
      await emitLeadEvent(tx, tenantId, emit, {
        eventType: CRM_LEAD_LOST_EVENT_TYPE,
        aggregateId: write.leadId,
        payload: buildLeadLostPayload(facts)
      });
    }
  }

  return { transitionId: row.id, sequence: Number(row.sequence) };
}
