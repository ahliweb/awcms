import type {
  AccessDecision,
  TenantContext
} from "../../identity-access/domain/access-control";
import {
  evaluateContentUpdateAccess,
  type ContentOwnershipAttributes
} from "./content-access-policy";

const UPDATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "update" as const
};

export type PageOwnershipAttributes = ContentOwnershipAttributes;

/**
 * Same author-own-unpublished-content override as
 * `post-access-policy.ts`'s `evaluatePostUpdateAccess`, fixed to
 * `blog_content.pages.update` (doc issue #539: "must follow the same
 * auth, tenant, RBAC/ABAC, ... patterns introduced in the blog post
 * API"). See `content-access-policy.ts` for the shared implementation and
 * `post-access-policy.ts` for the full ADR-0004 reasoning on why this
 * lives in `blog_content`, not the shared `evaluateAccess` engine.
 */
export function evaluatePageUpdateAccess(
  context: TenantContext,
  grantedPermissionKeys: ReadonlySet<string>,
  page: PageOwnershipAttributes
): AccessDecision {
  return evaluateContentUpdateAccess(
    context,
    grantedPermissionKeys,
    UPDATE_GUARD,
    page
  );
}
