/**
 * Escalation/timeout processing (Issue #747), built on the shared worker
 * runner (`src/lib/jobs/job-runner.ts`, `batching.ts`) — see
 * `scripts/workflow-escalations-dispatch.ts`. Runs against the
 * least-privilege `awcms_worker` role (migration 060's grants).
 *
 * IDEMPOTENCY GUARD (Issue #747 security requirement: "a task must never
 * be escalated/timed-out twice for the same due event"): the `UPDATE`
 * below is conditioned on `WHERE status = 'pending' AND escalation_step =
 * <the value read in THIS pass>` — a classic optimistic-concurrency
 * guard. If a concurrent run (or a retried pass) already advanced
 * `escalation_step` for this task, the `UPDATE` affects zero rows and
 * this function skips it — never double-escalates, and never throws (a
 * lost race is an expected, silent no-op, not a failure).
 */
import { withTenant } from "../../../lib/database/tenant-context";
import {
  recordCounter,
  recordGauge
} from "../../../lib/observability/metrics-port";
import {
  findNode,
  type ApprovalNode,
  type WorkflowGraph
} from "../domain/workflow-graph";
import { appendDomainEvent } from "../../domain-event-runtime/application/append-domain-event";
import {
  WORKFLOW_EVENT_VERSION,
  WORKFLOW_TASK_ESCALATED_EVENT_TYPE
} from "../../domain-event-runtime/domain/event-type-registry";

export type EscalateDueTasksResult = { count: number };

type DueTaskRow = {
  id: string;
  escalation_step: number;
  node_id: string;
  graph: unknown;
  workflow_key: string;
};

const DEFAULT_ESCALATION_BATCH_LIMIT = 25;

export async function escalateDueTasksForTenant(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  batchLimit: number = DEFAULT_ESCALATION_BATCH_LIMIT,
  correlationId?: string
): Promise<EscalateDueTasksResult> {
  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const dueRows = (await tx`
        SELECT t.id, t.escalation_step, t.node_id, d.graph, d.workflow_key
        FROM awcms_workflow_tasks t
        JOIN awcms_workflow_instances i ON i.id = t.workflow_instance_id
        JOIN awcms_workflow_definitions d ON d.id = i.workflow_definition_id
        WHERE t.tenant_id = ${tenantId} AND t.status = 'pending'
          AND t.due_at IS NOT NULL AND t.due_at <= ${now}
        ORDER BY t.due_at ASC
        LIMIT ${batchLimit}
      `) as DueTaskRow[];

      let count = 0;

      for (const row of dueRows) {
        const graph = row.graph as WorkflowGraph;
        const node = findNode(graph, row.node_id) as ApprovalNode | undefined;

        if (!node?.escalation) {
          // Defensive — `due_at` is only ever set from a node with an
          // `escalation` config (`workflow-graph-engine.ts`'s
          // `createApprovalTask`); reaching this means the definition
          // changed shape unexpectedly. Skip safely rather than throw.
          continue;
        }

        const nextStep = row.escalation_step + 1;
        const hasMoreEscalations = nextStep < node.escalation.maxEscalations;
        const nextDueAt = hasMoreEscalations
          ? new Date(now.getTime() + node.escalation.timeoutMinutes * 60_000)
          : null;

        const updatedRows = (await tx`
          UPDATE awcms_workflow_tasks
          SET escalation_step = ${nextStep}, escalated_at = ${now}, due_at = ${nextDueAt}
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
            AND status = 'pending' AND escalation_step = ${row.escalation_step}
          RETURNING id
        `) as { id: string }[];

        if (updatedRows.length === 0) {
          // Lost the optimistic-concurrency race (already escalated by a
          // concurrent run) — skip, not an error.
          continue;
        }

        // ON CONFLICT DO NOTHING (GHSA-9qwq-cmr5-6wfc): the escalation target
        // is frequently ALSO an original assignee of the task (escalating a
        // manager's task to that same manager's own queue is normal). This
        // INSERT used to hand them a SECOND live assignment row, which the
        // quorum evaluation then counted as a second eligible approver —
        // letting one person satisfy a 2-person quorum by themselves. If they
        // already hold a live ('pending'/'decided') assignment there is
        // nothing to add: they can already decide. Migration 018's partial
        // unique index is what this conflicts against.
        await tx`
          INSERT INTO awcms_workflow_task_assignments
            (tenant_id, workflow_task_id, tenant_user_id, status)
          VALUES (${tenantId}, ${row.id}, ${node.escalation.escalateToTenantUserId}, 'pending')
          ON CONFLICT DO NOTHING
        `;

        await appendDomainEvent(tx, tenantId, {
          eventType: WORKFLOW_TASK_ESCALATED_EVENT_TYPE,
          eventVersion: WORKFLOW_EVENT_VERSION,
          aggregateType: "workflow_task",
          aggregateId: row.id,
          producerModule: "workflow",
          correlationId,
          payload: {
            workflowKey: row.workflow_key,
            escalationStep: nextStep,
            maxEscalations: node.escalation.maxEscalations
          }
        });

        recordCounter("workflow_escalation_total");
        count += 1;
      }

      return { count };
    },
    { workClass: "background_sync" }
  );
}

/** Sampling gauges (Issue #747 §Metrics) — called once per tenant per job pass, not tied to escalation itself. */
export async function recordWorkflowBacklogGauges(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<void> {
  await withTenant(
    sql,
    tenantId,
    async (tx) => {
      const activeRows = (await tx`
        SELECT COUNT(*) AS count FROM awcms_workflow_instances
        WHERE tenant_id = ${tenantId} AND status = 'pending'
      `) as { count: string | number }[];
      const overdueRows = (await tx`
        SELECT COUNT(*) AS count FROM awcms_workflow_tasks
        WHERE tenant_id = ${tenantId} AND status = 'pending'
          AND due_at IS NOT NULL AND due_at <= ${now}
      `) as { count: string | number }[];

      recordGauge(
        "workflow_instances_active_total",
        Number(activeRows[0]?.count ?? 0)
      );
      recordGauge(
        "workflow_tasks_overdue_total",
        Number(overdueRows[0]?.count ?? 0)
      );
    },
    { workClass: "background_sync" }
  );
}
