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
  | "assign"
  | "configure"
  | "restore"
  | "purge";

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
  "assign",
  "configure",
  "restore",
  "purge"
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
