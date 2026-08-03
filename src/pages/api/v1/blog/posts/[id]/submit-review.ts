import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { log } from "../../../../../../lib/logging/logger";
import { extractBearerToken } from "../../../../../../modules/identity-access/application/session-lookup";
import {
  fetchGrantedPermissionKeys,
  resolveModuleEnabled,
  resolveTenantContext
} from "../../../../../../modules/identity-access/application/auth-context";
import { authorizeInTransaction } from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  fetchBlogPostById,
  transitionBlogPostStatus
} from "../../../../../../modules/blog-content/application/blog-post-directory";
import { evaluatePostUpdateAccess } from "../../../../../../modules/blog-content/domain/post-access-policy";
import { isValidStatusTransition } from "../../../../../../modules/blog-content/domain/post-status";

const ACTIVITY = { moduleKey: "blog_content", activityCode: "posts" };

/**
 * `POST /api/v1/blog/posts/{id}/submit-review` (Issue #538). Guard maps to
 * `blog_content.posts.update` (doc issue #538 §Permission Mapping) — same
 * `evaluatePostUpdateAccess` ownership rule as `PATCH .../{id}` applies, so
 * a draft's own author can submit it for review without needing the
 * broader update permission. Not idempotency-gated (not listed under doc
 * issue #538 §Idempotency Requirements) — the underlying status-transition
 * write is naturally idempotent (same status in, same status out).
 */
export const POST: APIRoute = async ({ request, params, locals }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  const postId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!postId) {
    return fail(400, "VALIDATION_ERROR", "Post id is required.");
  }

  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

    if (!context) {
      return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
    }

    const moduleEnabled = await resolveModuleEnabled(
      tx,
      tenantId,
      "blog_content"
    );

    if (!moduleEnabled) {
      return fail(
        403,
        "MODULE_DISABLED",
        "Module is disabled for this tenant."
      );
    }

    const post = await fetchBlogPostById(tx, tenantId, postId);

    if (!post) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    // ADR-0063 — the ownership rule is now a GRANT BASIS handed to the
    // chokepoint, not a decision made instead of it. `evaluatePostUpdateAccess`
    // still answers "may this author act without holding the permission", but
    // `authorizeInTransaction` is what decides, so ABAC (including an explicit
    // deny that overrules ownership), the platform-scope gate and SoD all apply
    // here exactly as they do on every other guarded route.
    const roleKeys = await fetchGrantedPermissionKeys(
      tx,
      tenantId,
      context.tenantUserId
    );
    const ownership = evaluatePostUpdateAccess(context, roleKeys, {
      authorTenantUserId: post.authorTenantUserId,
      status: post.status
    });

    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      {
        ...ACTIVITY,
        action: "update",
        resourceType: "blog_post",
        resourceId: postId
      },
      {
        ownershipGrant: {
          granted: ownership.allowed,
          reason: "author of an unpublished post"
        }
      }
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    if (!isValidStatusTransition(post.status, "review")) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot submit a post in status "${post.status}" for review.`
      );
    }

    const updated = await transitionBlogPostStatus(
      tx,
      tenantId,
      postId,
      "review"
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.submitted_for_review",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "info",
      message: `Blog post submitted for review: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.post.submitted-for-review", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId,
      slug: updated.slug
    });

    return ok(updated);
  });
};
