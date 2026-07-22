import type {
  AccessDecision,
  AccessRequest,
  TenantContext
} from "../../identity-access/domain/access-control";
import { evaluateAccess } from "../../identity-access/domain/access-control";
import type { BlogContentStatus } from "./post-status";

export type ContentOwnershipAttributes = {
  authorTenantUserId: string;
  status: BlogContentStatus;
};

/**
 * Generic "author may edit their own unpublished content" ABAC override,
 * factored out of Issue #538's `post-access-policy.ts` so Issue #539's
 * pages can reuse the exact same rule (doc issue #539: "same auth, tenant,
 * RBAC/ABAC, audit, idempotency, RLS, and standard response patterns
 * introduced in the blog post API") without duplicating the logic.
 *
 * Deliberately not part of `identity-access/domain/access-control.ts`'s
 * shared `evaluateAccess` — see `post-access-policy.ts` for the full
 * reasoning (ADR-0004 default-deny; a resource-ownership ALLOW override is
 * `blog_content`-specific business logic, not a cross-module primitive).
 */
export function evaluateContentUpdateAccess(
  context: TenantContext,
  grantedPermissionKeys: ReadonlySet<string>,
  updateGuard: AccessRequest,
  resource: ContentOwnershipAttributes
): AccessDecision {
  const roleDecision = evaluateAccess(
    context,
    updateGuard,
    grantedPermissionKeys
  );

  if (roleDecision.allowed) {
    return roleDecision;
  }

  if (
    roleDecision.matchedPolicy === "default_deny" &&
    resource.authorTenantUserId === context.tenantUserId &&
    resource.status !== "published"
  ) {
    return {
      allowed: true,
      reason: "Author may edit their own unpublished content.",
      matchedPolicy: "author_own_draft_allow"
    };
  }

  return roleDecision;
}
