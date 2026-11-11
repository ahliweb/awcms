/**
 * Dry-run of a DRAFT rule revision against a sample trigger (Issue #1165,
 * ADR-0159 section 3). It runs the same pure matching and planning the
 * consumer runs, plus three READS (is the candidate assignee an active user,
 * does the lead have a stop signal, how many live tasks it has) and writes
 * NOTHING: no task, no action, no notice, no audit row, no event.
 */
import type { SimulateInput } from "../domain/crm-follow-up-validation";
import {
  calendarOf,
  matchesTrigger,
  planTask
} from "../domain/rule-definition";
import { nextWorkingInstant } from "../domain/working-calendar";
import { isActiveTenantUser, leadHasStopSignal } from "./task-engine";

type Sql = Bun.SQL;

/** A lead id that matches nothing, for a simulation without a real lead. */
const NO_LEAD = "00000000-0000-4000-8000-000000000000";

export type SimulationResult = {
  matches: boolean;
  wouldCreateTask: boolean;
  blockedBy: ("not_matched" | "lead_stopped" | "capped")[];
  dueAt: string;
  escalateAt: string | null;
  assigneeTenantUserId: string | null;
  candidateAssigneeInactive: boolean;
  notices: { kind: "assigned" | "due"; scheduledAt: string }[];
  lead: { stopped: boolean; liveTasks: number } | null;
};

export async function simulateRevision(
  tx: Sql,
  tenantId: string,
  input: SimulateInput,
  now: Date = new Date()
): Promise<SimulationResult> {
  const facts = { ...input.trigger, leadId: input.leadId ?? NO_LEAD };
  const matches = matchesTrigger(input.definition, facts);
  const plan = planTask(input.definition, facts);
  const candidate = plan.assigneeTenantUserId;
  const candidateActive =
    candidate !== null && (await isActiveTenantUser(tx, tenantId, candidate));
  const assignee = candidateActive ? candidate : null;
  const blockedBy: SimulationResult["blockedBy"] = [];
  let lead: SimulationResult["lead"] = null;

  if (!matches) blockedBy.push("not_matched");

  if (input.leadId) {
    const stopped = await leadHasStopSignal(tx, tenantId, input.leadId);
    const rows = (await tx`
      SELECT count(*)::int AS n FROM awcms_crm_follow_up_tasks
      WHERE tenant_id = ${tenantId} AND lead_id = ${input.leadId}
        AND status IN ('open', 'escalated')
    `) as { n: number }[];
    const liveTasks = Number(rows[0]?.n ?? 0);

    lead = { stopped, liveTasks };

    if (stopped) blockedBy.push("lead_stopped");
    // A draft belongs to no rule yet, so the per-rule cap is judged against
    // every live task of the lead: the conservative reading.
    if (liveTasks >= input.definition.maxOpenPerLead) blockedBy.push("capped");
  }

  const calendar = calendarOf(input.definition);
  const notices: SimulationResult["notices"] = [];

  if (assignee !== null && blockedBy.length === 0) {
    if (input.definition.notify.onAssign) {
      notices.push({
        kind: "assigned",
        scheduledAt: nextWorkingInstant(calendar, now).toISOString()
      });
    }

    if (input.definition.notify.onDue) {
      notices.push({
        kind: "due",
        scheduledAt: nextWorkingInstant(
          calendar,
          plan.dueAt.getTime() > now.getTime() ? plan.dueAt : now
        ).toISOString()
      });
    }
  }

  return {
    matches,
    wouldCreateTask: blockedBy.length === 0,
    blockedBy,
    dueAt: plan.dueAt.toISOString(),
    escalateAt: plan.escalateAt?.toISOString() ?? null,
    assigneeTenantUserId: assignee,
    candidateAssigneeInactive: candidate !== null && !candidateActive,
    notices,
    lead
  };
}
