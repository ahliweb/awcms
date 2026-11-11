/**
 * Who may be an ASSIGNEE of a conversation (ADR-0160 section 3). Default-deny:
 * each condition must be proven, and anything unknown is "not eligible".
 *
 * 1. An ACTIVE tenant user of this tenant.
 * 2. Holding `omnichannel_inbox.conversations.update` on a TENANT-WIDE grant
 *    (the same reading `channel_accounts` uses for its administrator bypass;
 *    a scoped grant's keys are not trusted to act tenant-wide).
 * 3. If they are scope-CONFINED (any active, non-tenant assignment that has not
 *    ended — including one that has not started yet, the #1171/#1270
 *    fail-closed rule), the conversation must be scoped, and they must hold an
 *    active, STARTED assignment on that scope or on one of its ancestors
 *    (resolved through the business-scope hierarchy port; an unresolved scope
 *    is a denial). A tenant-wide conversation is never assigned to a confined
 *    person.
 *
 * The person's own ABAC deny policies cannot be evaluated here (that needs
 * their session); the chokepoint still applies them on every request they make.
 * The SLA job re-runs this predicate and unassigns anyone who no longer passes.
 */
import { holdsTenantWidePermissionKey } from "../../identity-access/application/auth-context";
import type { BusinessScopeHierarchyPort } from "../../_shared/ports/business-scope-hierarchy-port";
import { ASSIGNEE_PERMISSION_KEY } from "../domain/inbox-constants";
import type { ScopeRef } from "./sla-policy-directory";

export type IneligibleReason =
  | "user_inactive"
  | "permission_missing"
  | "scope_confined"
  | "scope_not_covered";

export type Eligibility =
  { eligible: true } | { eligible: false; reason: IneligibleReason };

export async function assigneeEligibility(
  tx: Bun.SQL,
  tenantId: string,
  tenantUserId: string,
  conversationScope: ScopeRef | null,
  now: Date,
  hierarchy: BusinessScopeHierarchyPort
): Promise<Eligibility> {
  const users = (await tx`
    SELECT status FROM awcms_tenant_users
    WHERE tenant_id = ${tenantId} AND id = ${tenantUserId}
  `) as { status: string }[];

  if (users[0]?.status !== "active") {
    return { eligible: false, reason: "user_inactive" };
  }

  if (
    !(await holdsTenantWidePermissionKey(
      tx,
      tenantId,
      tenantUserId,
      ASSIGNEE_PERMISSION_KEY
    ))
  ) {
    return { eligible: false, reason: "permission_missing" };
  }

  const confining = (await tx`
    SELECT 1 FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND status = 'active'
      AND scope_type <> 'tenant'
      AND (effective_to IS NULL OR effective_to > ${now})
    LIMIT 1
  `) as unknown[];

  if (confining.length === 0) return { eligible: true };

  if (!conversationScope) return { eligible: false, reason: "scope_confined" };

  const resolution = await hierarchy.resolveScope(
    tx,
    tenantId,
    conversationScope.type,
    conversationScope.id
  );

  if (!resolution.resolved) {
    return { eligible: false, reason: "scope_not_covered" };
  }

  const candidates = [
    `${conversationScope.type}:${conversationScope.id}`,
    ...resolution.ancestorScopes.map(
      (ancestor) => `${ancestor.scopeType}:${ancestor.scopeId}`
    )
  ];
  const held = (await tx`
    SELECT 1 FROM awcms_business_scope_assignments
    WHERE tenant_id = ${tenantId}
      AND tenant_user_id = ${tenantUserId}
      AND status = 'active'
      AND scope_type <> 'tenant'
      AND effective_from <= ${now}
      AND (effective_to IS NULL OR effective_to > ${now})
      AND (scope_type || ':' || scope_id::text) = ANY(${tx.array(candidates, "text")})
    LIMIT 1
  `) as unknown[];

  return held.length > 0
    ? { eligible: true }
    : { eligible: false, reason: "scope_not_covered" };
}
