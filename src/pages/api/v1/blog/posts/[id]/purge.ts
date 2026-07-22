import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  fetchBlogPostById,
  purgeBlogPost
} from "../../../../../../modules/blog-content/application/blog-post-directory";
import { canPurgePost } from "../../../../../../modules/blog-content/domain/post-status";

const PURGE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "purge" as const
};

const IDEMPOTENCY_SCOPE = "blog_post_purge";

/**
 * `POST /api/v1/blog/posts/{id}/purge` (Issue #538). Requires explicit
 * `blog_content.posts.purge` permission. Doc issue #538 §ABAC Rules:
 * "Purge is forbidden for published content unless archived or
 * soft-deleted first" (`canPurgePost`) — `409 PURGE_NOT_ALLOWED` otherwise,
 * not a raw constraint error. Hard `DELETE`; the post's
 * `awcms_blog_post_terms` rows are cleaned up by
 * `purgeBlogPost` itself. High-risk mutation: requires `Idempotency-Key`.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const postId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!postId) {
    return fail(400, "VALIDATION_ERROR", "Post id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const requestHash = computeRequestHash({ postId, action: "purge" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      PURGE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const post = await fetchBlogPostById(tx, tenantId, postId, {
      includeDeleted: true
    });

    if (!post) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    if (!canPurgePost(post.status, post.deletedAt)) {
      return fail(
        409,
        "PURGE_NOT_ALLOWED",
        "Post must be archived or soft-deleted before it can be purged."
      );
    }

    await purgeBlogPost(tx, tenantId, postId);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.purged",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "critical",
      message: "Blog post purged.",
      correlationId
    });

    log("info", "blog-content.post.purged", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId
    });

    const successResponse = ok({ id: postId, status: "purged" });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
