/**
 * `POST /api/v1/omes/ai-privacy/egress-approvals` (Issue ahliweb/omes#232,
 * OMES issue #217, ADR-0029) — an AWCMS owner submitting an approve/deny
 * decision on an `approval_required` AI egress policy decision.
 *
 * Authorization happens in three independent layers, matching this issue's
 * non-negotiable requirement that a RESTRICTED->cloud approval be
 * STRUCTURALLY impossible, not merely disallowed by convention:
 *
 *   1. `OMES_GUARDS.aiPrivacy.approve` (RBAC/ABAC) — checked by the route's
 *      `defineTenantRoute({ authorize })`, BEFORE this function runs at all.
 *   2. `authorizeAiEgressApproval` (this file, `domain/ai-privacy.ts`) — a
 *      pure, unconditional value check refusing RESTRICTED+cloud_sanitized
 *      regardless of what the caller submitted, mirroring OMES's own
 *      `posture_projection.py::authorize_approval()`.
 *   3. `awcms_omes_ai_egress_approvals`'s own CHECK constraint (sql/160) —
 *      the database itself refuses to store that combination even if a
 *      future code path somehow bypassed both application-layer checks.
 *
 * The approval DECISION authority is the existing `workflow-approval`
 * engine's `startWorkflowInstance` — never a second approval authority.
 * Exactly `backup-restore.ts`'s established pattern: an intent row is
 * recorded FIRST, `startWorkflowInstance` is called under a workflow key
 * dedicated to this decision class, and `WorkflowDefinitionNotActiveError`
 * degrades to a fail-closed `approval_workflow_not_configured` outcome —
 * nothing is silently auto-approved when a tenant has never published an
 * approval workflow for AI egress decisions.
 */
import {
  startWorkflowInstance,
  WorkflowDefinitionNotActiveError
} from "../../workflow-approval/application/workflow-instance";
import { redactSensitiveAttributes } from "../../_shared/redaction";
import {
  authorizeAiEgressApproval,
  type AiEgressDecisionRef
} from "../domain/ai-privacy";
import type { AiEgressApprovalSummary } from "./ai-privacy-directory";

/**
 * Workflow key a tenant's active, published `workflow-approval` definition
 * must use for an AI egress owner-approval decision to be recorded at all.
 * Distinct from `OMES_DESTRUCTIVE_WORKFLOW_KEY` (`domain/operations.ts`) —
 * a different decision class with its own facts shape (classification/
 * destination/reason_code, never an OMES operation name).
 */
export const AI_EGRESS_APPROVAL_WORKFLOW_KEY =
  "omes_control.ai_egress_approval";

type ApprovalRow = {
  id: string;
  server_id: string;
  deployment_id: string | null;
  policy_version: string;
  classification: string;
  destination: string;
  reason_code: string;
  justification: string | null;
  requested_approve: boolean;
  decision: string;
  decision_reason: string | null;
  decision_reason_code: string | null;
  workflow_instance_id: string | null;
  created_at: Date;
  decided_at: Date | null;
};

const APPROVAL_RETURNING = `
  id, server_id, deployment_id, policy_version, classification, destination,
  reason_code, justification, requested_approve, decision, decision_reason,
  decision_reason_code, workflow_instance_id, created_at, decided_at
`;

function toSummary(row: ApprovalRow): AiEgressApprovalSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    policyVersion: row.policy_version,
    classification: row.classification,
    destination: row.destination,
    reasonCode: row.reason_code,
    justification: row.justification
      ? ((redactSensitiveAttributes({ justification: row.justification })
          ?.justification as string) ?? row.justification)
      : null,
    requestedApprove: row.requested_approve,
    decision: row.decision,
    decisionReason: row.decision_reason,
    decisionReasonCode: row.decision_reason_code,
    workflowInstanceId: row.workflow_instance_id,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null
  };
}

export type AiEgressApprovalSubmission = {
  correlationId: string;
  idempotencyKey: string;
  serverId: string;
  deploymentId?: string;
  policyVersion: string;
  classification: string;
  destination: string;
  reasonCode: string;
  justification?: string;
  approve: boolean;
};

export type SubmitAiEgressApprovalOutcome =
  | { outcome: "recorded"; approval: AiEgressApprovalSummary }
  | { outcome: "denied_structurally"; reason: string; reasonCode: string }
  | { outcome: "approval_workflow_not_configured" };

/**
 * Records one owner-approval decision. `approve: false` (an explicit
 * denial) and a structurally-refused `approve: true` (not-approvable
 * reason_code, or the RESTRICTED->cloud combination) are both recorded as
 * `decision: "denied"` WITHOUT ever calling into `workflow-approval` — the
 * workflow engine is the authority for turning an APPROVABLE request into
 * an approved outcome, never for producing a denial (a denial needs no
 * approval authority at all).
 */
export async function submitAiEgressApproval(
  tx: Bun.SQL,
  tenantId: string,
  requestedByTenantUserId: string,
  input: AiEgressApprovalSubmission,
  now: Date,
  correlationId?: string
): Promise<SubmitAiEgressApprovalOutcome> {
  const decisionRef: AiEgressDecisionRef = {
    classification: input.classification,
    destination: input.destination,
    reasonCode: input.reasonCode
  };

  const authorization = authorizeAiEgressApproval({
    requesterTenantId: tenantId,
    tenantId,
    decisionRef,
    approve: input.approve
  });

  if (!authorization.allow) {
    // Recorded for audit (queryable via fetchAiEgressApprovals) even though
    // the caller only needs reason/reasonCode below — a denied request must
    // still leave a durable trail, the same as an approved one.
    await tx`
      INSERT INTO awcms_omes_ai_egress_approvals (
        tenant_id, correlation_id, idempotency_key, server_id, deployment_id,
        policy_version, classification, destination, reason_code,
        justification, requested_approve, decision, decision_reason,
        decision_reason_code, requested_by_tenant_user_id, decided_at
      ) VALUES (
        ${tenantId}, ${input.correlationId}, ${input.idempotencyKey},
        ${input.serverId}, ${input.deploymentId ?? null},
        ${input.policyVersion}, ${input.classification}, ${input.destination},
        ${input.reasonCode}, ${input.justification ?? null},
        ${input.approve}, 'denied', ${authorization.reason},
        ${authorization.reasonCode}, ${requestedByTenantUserId}, ${now}
      )
      RETURNING id
    `;

    return {
      outcome: "denied_structurally",
      reason: authorization.reason,
      reasonCode: authorization.reasonCode
    };
  }

  const insertedRows = (await tx`
    INSERT INTO awcms_omes_ai_egress_approvals (
      tenant_id, correlation_id, idempotency_key, server_id, deployment_id,
      policy_version, classification, destination, reason_code,
      justification, requested_approve, decision, requested_by_tenant_user_id
    ) VALUES (
      ${tenantId}, ${input.correlationId}, ${input.idempotencyKey},
      ${input.serverId}, ${input.deploymentId ?? null},
      ${input.policyVersion}, ${input.classification}, ${input.destination},
      ${input.reasonCode}, ${input.justification ?? null},
      ${input.approve}, 'pending', ${requestedByTenantUserId}
    )
    RETURNING ${tx.unsafe(APPROVAL_RETURNING)}
  `) as ApprovalRow[];
  const inserted = insertedRows[0]!;

  try {
    const workflow = await startWorkflowInstance(tx, {
      tenantId,
      workflowKey: AI_EGRESS_APPROVAL_WORKFLOW_KEY,
      resourceType: "omes_ai_egress_approval",
      resourceId: inserted.id,
      requestedByTenantUserId,
      facts: {
        serverId: input.serverId,
        classification: input.classification,
        destination: input.destination,
        reasonCode: input.reasonCode
      },
      now,
      correlationId
    });

    const decision = workflow.finished
      ? workflow.status === "approved"
        ? "approved"
        : "denied"
      : "pending";

    const updatedRows = (await tx`
      UPDATE awcms_omes_ai_egress_approvals
      SET workflow_instance_id = ${workflow.instanceId},
          decision = ${decision},
          decision_reason_code = ${authorization.reasonCode},
          decided_at = ${decision === "pending" ? null : now},
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${inserted.id}
      RETURNING ${tx.unsafe(APPROVAL_RETURNING)}
    `) as ApprovalRow[];

    return { outcome: "recorded", approval: toSummary(updatedRows[0]!) };
  } catch (error) {
    if (error instanceof WorkflowDefinitionNotActiveError) {
      return { outcome: "approval_workflow_not_configured" };
    }
    throw error;
  }
}
