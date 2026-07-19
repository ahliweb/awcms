export type TenantContext = {
  tenantId: string;
  tenantUserId: string;
  identityId: string;
  roles: string[];
  correlationId?: string;
};

/**
 * Grows one literal at a time as a real endpoint needs it (same convention
 * as `awcms-mini`'s own `identity-access/domain/access-control.ts`) — never
 * pre-declare an action for a module that doesn't exist yet.
 */
export type AccessAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "assign"
  | "configure"
  | "restore"
  | "purge"
  | "retry"
  | "sync"
  | "enable"
  | "disable"
  | "check"
  | "replay"
  | "manage"
  // Workflow-approval actions (ported alongside the workflow module).
  | "publish"
  | "retire"
  | "cancel"
  | "reassign"
  | "force_decide"
  | "revoke"
  // Reporting actions (ported alongside the reporting module): `rebuild`
  // and `export` mutate/produce artifacts (high-risk); `analyze` is a
  // read-only reconciliation analysis (not high-risk, same posture as a
  // dry-run).
  | "rebuild"
  | "analyze"
  | "export"
  // MFA administration (Issue #184): `reset` disables another user's factor
  // (high-risk); `configure` sets the tenant MFA enforcement policy.
  | "reset";

export type AccessRequest = {
  moduleKey: string;
  activityCode: string;
  action: AccessAction;
  resourceType?: string;
  resourceId?: string;
  resourceAttributes?: Record<string, unknown>;
};

export type AccessDecision = {
  allowed: boolean;
  reason: string;
  matchedPolicy?: string;
};

const HIGH_RISK_ACTIONS: ReadonlySet<AccessAction> = new Set([
  "delete",
  "approve",
  "assign",
  "configure",
  "restore",
  "purge",
  "sync",
  "enable",
  "disable",
  "replay",
  "manage",
  "publish",
  "retire",
  "cancel",
  "reassign",
  "force_decide",
  "revoke",
  "rebuild",
  "export"
]);

export function isHighRiskAction(action: AccessAction): boolean {
  return HIGH_RISK_ACTIONS.has(action);
}

export function permissionKey(
  moduleKey: string,
  activityCode: string,
  action: string
): string {
  return `${moduleKey}.${activityCode}.${action}`;
}

/** Default deny, deny overrides allow. */
export function evaluateAccess(
  context: TenantContext,
  request: AccessRequest,
  grantedPermissionKeys: ReadonlySet<string>
): AccessDecision {
  const resourceTenantId = request.resourceAttributes?.tenantId;

  if (resourceTenantId !== undefined && resourceTenantId !== context.tenantId) {
    return {
      allowed: false,
      reason: "Resource belongs to a different tenant.",
      matchedPolicy: "tenant_isolation"
    };
  }

  // Self-approval guard (ported alongside workflow-approval). When a caller
  // opts a request into it by supplying `requestedByTenantUserId`, an actor
  // may never approve a request they themselves filed. Two directions are
  // covered: the ordinary `approve` action, and the administrative
  // `force_decide` override (which bypasses quorum entirely — a caller who
  // filed their own instance AND holds `workflow.recovery.force_decide`
  // would otherwise be able to force-approve their own request, structurally
  // bypassing the `approve`-only check). No pre-existing call site sets
  // `requestedByTenantUserId`, so this is inert for every other endpoint.
  const requestedBy = request.resourceAttributes?.requestedByTenantUserId;

  if (
    (request.action === "approve" || request.action === "force_decide") &&
    requestedBy !== undefined &&
    requestedBy === context.tenantUserId
  ) {
    return {
      allowed: false,
      reason:
        request.action === "approve"
          ? "Self-approval is not allowed."
          : "Self-administered force-decision is not allowed.",
      matchedPolicy: "self_approval_deny"
    };
  }

  const key = permissionKey(
    request.moduleKey,
    request.activityCode,
    request.action
  );

  if (!grantedPermissionKeys.has(key)) {
    return {
      allowed: false,
      reason: "No role permission grants this action.",
      matchedPolicy: "default_deny"
    };
  }

  return {
    allowed: true,
    reason: "Granted via role permission.",
    matchedPolicy: "role_permission"
  };
}
