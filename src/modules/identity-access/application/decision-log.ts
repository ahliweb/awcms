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
  // Issue #179 — the dsl_version of the stored ABAC policy that produced the
  // decision (when one did). Only the policy CODE, VERSION, and a static reason
  // string are ever logged — never resource attribute VALUES or subject
  // identifiers beyond the tenant_user_id column, so no raw PII/sensitive
  // identifier reaches this table (issue #179 decision-log requirement).
  matchedPolicyVersion?: number;
};

/**
 * `machineCredentialId` (ADR-0049 §6) — WHICH credential authenticated this
 * decision, not just which account it acted as. Several credentials may point
 * at the same service account, so `tenant_user_id` alone cannot answer the
 * forensic question. `undefined` for every human decision, which is every
 * pre-existing call site.
 */
export async function recordDecisionLog(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string | null,
  request: DecisionLogRequest,
  outcome: DecisionLogOutcome,
  machineCredentialId?: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_abac_decision_logs
      (tenant_id, tenant_user_id, module_key, activity_code, action, resource_type, resource_id, decision, reason, matched_policy, matched_policy_version, machine_credential_id)
    VALUES (
      ${tenantId}, ${tenantUserId}, ${request.moduleKey}, ${request.activityCode}, ${request.action},
      ${request.resourceType ?? null}, ${request.resourceId ?? null},
      ${outcome.allowed ? "allow" : "deny"}, ${outcome.reason}, ${outcome.matchedPolicy ?? null},
      ${outcome.matchedPolicyVersion ?? null}, ${machineCredentialId ?? null}
    )
  `;
}
