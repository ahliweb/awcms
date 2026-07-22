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
  activityCode: "posts",
  action: "update" as const
};

export type PostOwnershipAttributes = ContentOwnershipAttributes;

/**
 * Issue #538 §ABAC Rules: "Author may edit own draft post if the post is
 * not published" alongside "Editor/Admin with permission may edit all
 * tenant posts." Both are expressed through the single
 * `blog_content.posts.update` permission (doc issue #537's seed has no
 * separate "update own" vs "update all" action) — a role holding that
 * permission may update ANY tenant post (the "Editor/Admin" case); a
 * tenant user who does NOT hold it may still update a post they authored,
 * as long as it is not yet published (the "Author" case).
 *
 * This intentionally does not live in
 * `identity-access/domain/access-control.ts`'s shared `evaluateAccess` —
 * that engine is a generic, deny-biased evaluator reused across every
 * module (ADR-0004 "default deny, deny overrides allow"); a resource-
 * ownership ALLOW override is blog_content-specific business logic, not a
 * cross-module primitive like the self-approval deny rule it already
 * has. Composing on top of it here (call the generic decision first, only
 * consult ownership when the sole reason for denial was a missing role
 * permission) keeps the shared engine's default-deny guarantee intact
 * while still supporting the per-module exception.
 *
 * Issue #539 factored the actual logic out to
 * `content-access-policy.ts`'s `evaluateContentUpdateAccess` so
 * `page-access-policy.ts` can reuse it for pages — this function is now a
 * thin wrapper fixing the guard to `blog_content.posts.update`, kept for
 * the resource-specific name callers already use.
 */
export function evaluatePostUpdateAccess(
  context: TenantContext,
  grantedPermissionKeys: ReadonlySet<string>,
  post: PostOwnershipAttributes
): AccessDecision {
  return evaluateContentUpdateAccess(
    context,
    grantedPermissionKeys,
    UPDATE_GUARD,
    post
  );
}
