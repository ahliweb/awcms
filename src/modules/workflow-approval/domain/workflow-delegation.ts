/**
 * Delegation/substitute-assignment domain logic (Issue #747). Pure
 * functions — `application/workflow-delegation-directory.ts` owns all
 * I/O. A delegation lets `delegateTenantUserId` act on behalf of
 * `delegatorTenantUserId` for a bounded, effective-dated, optionally
 * workflow-key/resource-type-scoped window — it NEVER broadens the
 * delegate's own authority: the delegate must still separately hold the
 * `workflow.approval.approve` permission (checked by ordinary ABAC) to
 * record the decision at all, and self-approval is still evaluated
 * against the ORIGINAL requester (a delegate cannot be used to approve a
 * request the delegator themselves filed, since the self-approval guard
 * compares `context.tenantUserId`, i.e. the delegate, against the
 * instance's `requestedByTenantUserId` unchanged — see
 * `application/workflow-instance-decision.ts`).
 */

export type WorkflowDelegationRow = {
  id: string;
  delegatorTenantUserId: string;
  delegateTenantUserId: string;
  workflowKey: string | null;
  resourceType: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "active" | "revoked";
};

export type DelegationScopeQuery = {
  workflowKey: string;
  resourceType: string;
};

/**
 * `null`/absent `workflowKey`/`resourceType` on the delegation row means
 * "applies to all" — an explicit, narrower scope on the row (e.g. a
 * specific `workflowKey`) restricts it to only that scope, it can never
 * WIDEN beyond what the delegation row itself declares.
 */
function delegationCoversScope(
  delegation: WorkflowDelegationRow,
  scope: DelegationScopeQuery
): boolean {
  if (
    delegation.workflowKey !== null &&
    delegation.workflowKey !== scope.workflowKey
  ) {
    return false;
  }
  if (
    delegation.resourceType !== null &&
    delegation.resourceType !== scope.resourceType
  ) {
    return false;
  }
  return true;
}

function delegationActiveAt(
  delegation: WorkflowDelegationRow,
  now: Date
): boolean {
  if (delegation.status !== "active") {
    return false;
  }
  if (delegation.effectiveFrom > now) {
    return false;
  }
  if (delegation.effectiveTo !== null && delegation.effectiveTo <= now) {
    return false;
  }
  return true;
}

/**
 * Returns the set of tenant user ids allowed to act as `assigneeTenantUserId`
 * right now, for the given workflow key/resource type — always includes
 * the original assignee themselves (delegation is additive, never
 * revokes the original assignee's own standing), plus any currently
 * active, in-scope delegate.
 */
export function resolveEffectiveDeciderIds(
  assigneeTenantUserId: string,
  delegations: readonly WorkflowDelegationRow[],
  now: Date,
  scope: DelegationScopeQuery
): string[] {
  const deciderIds = new Set<string>([assigneeTenantUserId]);

  for (const delegation of delegations) {
    if (delegation.delegatorTenantUserId !== assigneeTenantUserId) {
      continue;
    }
    if (!delegationActiveAt(delegation, now)) {
      continue;
    }
    if (!delegationCoversScope(delegation, scope)) {
      continue;
    }
    deciderIds.add(delegation.delegateTenantUserId);
  }

  return [...deciderIds];
}

export type DelegationInputValidationError = { field: string; message: string };

export type CreateDelegationInput = {
  delegateTenantUserId: string;
  workflowKey?: string;
  resourceType?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  reason: string;
};

export type CreateDelegationValidationResult =
  | { valid: true; value: CreateDelegationInput }
  | { valid: false; errors: DelegationInputValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 500;

export function validateCreateDelegationRequestBody(
  body: unknown,
  delegatorTenantUserId: string
): CreateDelegationValidationResult {
  const errors: DelegationInputValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const delegateTenantUserId = record.delegateTenantUserId;

  if (
    typeof delegateTenantUserId !== "string" ||
    !UUID_PATTERN.test(delegateTenantUserId)
  ) {
    errors.push({
      field: "delegateTenantUserId",
      message: "delegateTenantUserId must be a UUID."
    });
  } else if (delegateTenantUserId === delegatorTenantUserId) {
    errors.push({
      field: "delegateTenantUserId",
      message: "Cannot delegate to yourself."
    });
  }

  const reason = record.reason;

  if (
    typeof reason !== "string" ||
    reason.trim().length === 0 ||
    reason.length > MAX_REASON_LENGTH
  ) {
    errors.push({
      field: "reason",
      message: `reason is required (1-${MAX_REASON_LENGTH} characters).`
    });
  }

  let effectiveFrom: string | undefined;
  let effectiveTo: string | undefined;

  if (record.effectiveFrom !== undefined) {
    if (
      typeof record.effectiveFrom !== "string" ||
      Number.isNaN(Date.parse(record.effectiveFrom))
    ) {
      errors.push({
        field: "effectiveFrom",
        message: "must be an ISO 8601 date-time string."
      });
    } else {
      effectiveFrom = record.effectiveFrom;
    }
  }

  if (record.effectiveTo !== undefined) {
    if (
      typeof record.effectiveTo !== "string" ||
      Number.isNaN(Date.parse(record.effectiveTo))
    ) {
      errors.push({
        field: "effectiveTo",
        message: "must be an ISO 8601 date-time string."
      });
    } else {
      effectiveTo = record.effectiveTo;
    }
  }

  if (
    effectiveFrom &&
    effectiveTo &&
    new Date(effectiveTo).getTime() <= new Date(effectiveFrom).getTime()
  ) {
    errors.push({
      field: "effectiveTo",
      message: "must be after effectiveFrom."
    });
  }

  if (
    record.workflowKey !== undefined &&
    (typeof record.workflowKey !== "string" || record.workflowKey.length === 0)
  ) {
    errors.push({
      field: "workflowKey",
      message: "must be a non-empty string."
    });
  }

  if (
    record.resourceType !== undefined &&
    (typeof record.resourceType !== "string" ||
      record.resourceType.length === 0)
  ) {
    errors.push({
      field: "resourceType",
      message: "must be a non-empty string."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      delegateTenantUserId: delegateTenantUserId as string,
      workflowKey: record.workflowKey as string | undefined,
      resourceType: record.resourceType as string | undefined,
      effectiveFrom,
      effectiveTo,
      reason: (reason as string).trim()
    }
  };
}
