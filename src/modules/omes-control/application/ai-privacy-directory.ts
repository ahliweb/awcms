/**
 * Read-side queries for `/admin/omes/ai-privacy` and
 * `GET /api/v1/omes/ai-privacy/posture` (Issue ahliweb/omes#232).
 *
 * Every row's `evidenceFreshness`/`effectiveStatus` is RECOMPUTED here, at
 * read time, via `domain/ai-privacy.ts`'s `projectAiPrivacyPosture` — never
 * read directly off the stored `status`/`last_verified_at` columns. This is
 * the same "second independent backstop" discipline OMES's own
 * `posture_projection.py` documents: stale or unrecognized evidence must
 * never render as healthy, and it must not depend on a background job
 * having run recently to flip a flag.
 */
import { redactSensitiveAttributes } from "../../_shared/redaction";
import {
  projectAiPrivacyPosture,
  type ProjectedAiPrivacyPosture
} from "../domain/ai-privacy";

export type AiPrivacyLatestDecision = {
  policyVersion: string;
  classification: string;
  destination: string;
  decision: string;
  reasonCodes: string[];
} | null;

export type AiPrivacyPostureSummary = ProjectedAiPrivacyPosture & {
  id: string;
  serverId: string;
  deploymentId: string | null;
  correlationId: string;
  receivedAt: string;
  latestDecision: AiPrivacyLatestDecision;
};

type PostureRow = {
  id: string;
  server_id: string;
  deployment_id: string | null;
  authority: string;
  classification_mode: string;
  destination_class: string;
  local_endpoint_classification: string | null;
  status: string;
  reason_codes: string[];
  last_verified_at: Date | null;
  projected_at: Date;
  latest_decision: Record<string, unknown> | null;
  correlation_id: string;
  received_at: Date;
};

function toLatestDecision(
  raw: Record<string, unknown> | null
): AiPrivacyLatestDecision {
  if (!raw || typeof raw !== "object") return null;

  const reasonCodes = Array.isArray(raw.reason_codes)
    ? (raw.reason_codes as string[]).filter((code) => typeof code === "string")
    : [];

  return {
    policyVersion: String(raw.policy_version ?? "unknown"),
    classification: String(raw.classification ?? "unknown"),
    destination: String(raw.destination ?? "unknown"),
    decision: String(raw.decision ?? "deny"),
    reasonCodes
  };
}

export const AI_PRIVACY_POSTURE_LIST_LIMIT = 200;

function toSummary(row: PostureRow, now: Date): AiPrivacyPostureSummary {
  const projected = projectAiPrivacyPosture(
    {
      authority: row.authority,
      classificationMode: row.classification_mode,
      destinationClass: row.destination_class,
      localEndpointClassification: row.local_endpoint_classification,
      status: row.status,
      reasonCodes: row.reason_codes ?? [],
      lastVerifiedAt: row.last_verified_at
        ? row.last_verified_at.toISOString()
        : null,
      projectedAt: row.projected_at.toISOString()
    },
    now
  );

  return {
    ...projected,
    id: row.id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    correlationId: row.correlation_id,
    receivedAt: row.received_at.toISOString(),
    latestDecision: toLatestDecision(row.latest_decision)
  };
}

export type AiPrivacyPostureListPage = {
  posture: AiPrivacyPostureSummary[];
  /** True when EVERY posture row's effectiveStatus is PASS. An empty fleet is "unknown", never "healthy". */
  fleetHealthy: boolean;
};

/** Every AI-privacy posture row for the tenant's fleet, newest-received first. */
export async function fetchAiPrivacyPosture(
  tx: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<AiPrivacyPostureListPage> {
  const rows = (await tx`
    SELECT id, server_id, deployment_id, authority, classification_mode,
           destination_class, local_endpoint_classification, status,
           reason_codes, last_verified_at, projected_at, latest_decision,
           correlation_id, received_at
    FROM awcms_omes_ai_privacy_posture
    WHERE tenant_id = ${tenantId}
    ORDER BY received_at DESC, id DESC
    LIMIT ${AI_PRIVACY_POSTURE_LIST_LIMIT}
  `) as PostureRow[];

  const posture = rows.map((row) => toSummary(row, now));

  return {
    posture,
    fleetHealthy: posture.length > 0 && posture.every((row) => row.isHealthy)
  };
}

export type AiEgressApprovalSummary = {
  id: string;
  serverId: string;
  deploymentId: string | null;
  policyVersion: string;
  classification: string;
  destination: string;
  reasonCode: string;
  justification: string | null;
  requestedApprove: boolean;
  decision: string;
  decisionReason: string | null;
  decisionReasonCode: string | null;
  workflowInstanceId: string | null;
  createdAt: string;
  decidedAt: string | null;
};

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

export const AI_EGRESS_APPROVAL_LIST_LIMIT = 200;

function toApprovalSummary(row: ApprovalRow): AiEgressApprovalSummary {
  return {
    id: row.id,
    serverId: row.server_id,
    deploymentId: row.deployment_id,
    policyVersion: row.policy_version,
    classification: row.classification,
    destination: row.destination,
    reasonCode: row.reason_code,
    // `justification` is an operator-authored short note (schema-bounded to
    // 500 chars) — redacted the same as any other free-text operator
    // attribute, defense-in-depth alongside the schema bound itself.
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

export async function fetchAiEgressApprovals(
  tx: Bun.SQL,
  tenantId: string
): Promise<AiEgressApprovalSummary[]> {
  const rows = (await tx`
    SELECT id, server_id, deployment_id, policy_version, classification,
           destination, reason_code, justification, requested_approve,
           decision, decision_reason, decision_reason_code,
           workflow_instance_id, created_at, decided_at
    FROM awcms_omes_ai_egress_approvals
    WHERE tenant_id = ${tenantId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${AI_EGRESS_APPROVAL_LIST_LIMIT}
  `) as ApprovalRow[];

  return rows.map(toApprovalSummary);
}
