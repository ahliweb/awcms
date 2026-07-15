export type DecisionLogRequest = {
  moduleKey: string;
  activityCode: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
};

export type DecisionLogOutcome = {
  allowed: boolean;
  reason: string;
  matchedPolicy?: string;
};

export async function recordDecisionLog(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string | null,
  request: DecisionLogRequest,
  outcome: DecisionLogOutcome
): Promise<void> {
  await tx`
    INSERT INTO awcms_abac_decision_logs
      (tenant_id, tenant_user_id, module_key, activity_code, action, resource_type, resource_id, decision, reason, matched_policy)
    VALUES (
      ${tenantId}, ${tenantUserId}, ${request.moduleKey}, ${request.activityCode}, ${request.action},
      ${request.resourceType ?? null}, ${request.resourceId ?? null},
      ${outcome.allowed ? "allow" : "deny"}, ${outcome.reason}, ${outcome.matchedPolicy ?? null}
    )
  `;
}
