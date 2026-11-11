/**
 * The `crm_follow_up.lead_signals` consumer (Issue #1165, ADR-0159, ADR-0134):
 * what each `crm_leads` event means for follow-up work.
 *
 *   lead.created        -> trigger `lead_created` (owner from the payload)
 *   lead.stage_changed  -> trigger `stage_entered`
 *   lead.assigned       -> live `lead_owner` tasks follow the new owner, then
 *                          trigger `lead_assigned` for the new owner
 *   lead.converted      -> stop `converted`
 *   lead.lost           -> stop `lost`
 *   lead.merged         -> stop `merged` for the ABSORBED lead
 *
 * Runs as `awcms_worker` inside the dispatcher's tenant transaction. It reads
 * ids and closed codes from the payload only (ADR-0153 L6: the payload holds
 * nothing else) and never reads a `crm_leads` table. An event for a tenant
 * where the module is not active is ignored: it is not replayed later.
 *
 * Idempotent twice over: the runtime's per-(consumer, event) effect ledger,
 * and the natural keys (a task per (rule, source event), a lead-event stop per
 * (source event, kind)), which hold even if the handler is called directly.
 */
import type { DomainEventForHandler } from "../../_shared/domain-event-consumer-contract";
import {
  LEAD_ASSIGNED_EVENT,
  LEAD_CONVERTED_EVENT,
  LEAD_CREATED_EVENT,
  LEAD_LOST_EVENT,
  LEAD_MERGED_EVENT,
  LEAD_STAGE_CHANGED_EVENT,
  STAGE_CATEGORIES,
  type StageCategory
} from "../domain/crm-follow-up-constants";
import { isUuid } from "../domain/crm-follow-up-validation";
import type { TriggerFacts } from "../domain/rule-definition";
import { isActiveForTenant } from "./settings-directory";
import {
  createTasksForTrigger,
  reassignLeadOwnerTasks,
  recordStopSignal
} from "./task-engine";

type Sql = Bun.SQL;

function uuidOrNull(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

function category(value: unknown): StageCategory | null {
  return typeof value === "string" &&
    STAGE_CATEGORIES.includes(value as StageCategory)
    ? (value as StageCategory)
    : null;
}

function stageKey(value: unknown): string | null {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(value)
    ? value
    : null;
}

function instant(value: unknown, fallback: Date): Date {
  if (typeof value !== "string") return fallback;

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export type LeadSignalResult =
  | { handled: false; reason: "inactive" | "ignored" | "malformed" }
  | { handled: true; kind: string };

export async function handleLeadSignal(
  tx: Sql,
  tenantId: string,
  event: DomainEventForHandler,
  now: Date = new Date()
): Promise<LeadSignalResult> {
  if (!(await isActiveForTenant(tx, tenantId))) {
    return { handled: false, reason: "inactive" };
  }

  const payload = event.payload ?? {};
  const eventId = event.id;

  switch (event.eventType) {
    case LEAD_CREATED_EVENT:
    case LEAD_STAGE_CHANGED_EVENT: {
      const leadId = uuidOrNull(payload.leadId);

      if (!leadId) return { handled: false, reason: "malformed" };

      const created = event.eventType === LEAD_CREATED_EVENT;
      const facts: TriggerFacts = {
        kind: created ? "lead_created" : "stage_entered",
        leadId,
        pipelineId: uuidOrNull(payload.pipelineId),
        stageCategory: category(
          created ? payload.stageCategory : payload.toCategory
        ),
        stageKey: stageKey(created ? payload.stageKey : payload.toStageKey),
        ownerTenantUserId: created
          ? uuidOrNull(payload.ownerTenantUserId)
          : null,
        occurredAt: instant(payload.occurredAt, event.occurredAt)
      };

      await createTasksForTrigger(tx, tenantId, facts, eventId, now);
      return { handled: true, kind: facts.kind };
    }
    case LEAD_ASSIGNED_EVENT: {
      const leadId = uuidOrNull(payload.leadId);

      if (!leadId) return { handled: false, reason: "malformed" };

      const owner = uuidOrNull(payload.toOwnerTenantUserId);

      await reassignLeadOwnerTasks(tx, tenantId, leadId, owner, now);

      if (owner !== null) {
        await createTasksForTrigger(
          tx,
          tenantId,
          {
            kind: "lead_assigned",
            leadId,
            pipelineId: null,
            stageCategory: null,
            stageKey: null,
            ownerTenantUserId: owner,
            occurredAt: instant(payload.assignedAt, event.occurredAt)
          },
          eventId,
          now
        );
      }

      return { handled: true, kind: "lead_assigned" };
    }
    case LEAD_CONVERTED_EVENT:
    case LEAD_LOST_EVENT:
    case LEAD_MERGED_EVENT: {
      const merged = event.eventType === LEAD_MERGED_EVENT;
      const leadId = uuidOrNull(
        merged ? payload.absorbedLeadId : payload.leadId
      );

      if (!leadId) return { handled: false, reason: "malformed" };

      const kind =
        event.eventType === LEAD_CONVERTED_EVENT
          ? "converted"
          : merged
            ? "merged"
            : "lost";

      await recordStopSignal(tx, tenantId, {
        leadId,
        kind,
        source: "lead_event",
        sourceEventId: eventId,
        recordedBy: null,
        occurredAt: instant(
          merged ? payload.mergedAt : payload.occurredAt,
          event.occurredAt
        )
      });

      return { handled: true, kind };
    }
    default:
      return { handled: false, reason: "ignored" };
  }
}
