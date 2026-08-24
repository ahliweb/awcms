import type { APIRoute } from "astro";

import { enqueueModuleContentPurge } from "../../../../../../lib/edge-cache/content-purge";
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
  restoreBlogPost
} from "../../../../../../modules/blog-content/application/blog-post-directory";
import { canRestorePost } from "../../../../../../modules/blog-content/domain/post-status";

const RESTORE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "restore" as const
};

const IDEMPOTENCY_SCOPE = "blog_post_restore";

/** `POST /api/v1/blog/posts/{id}/restore` (Issue #538). Requires explicit `blog_content.posts.restore` permission. 404 if the post is not currently soft-deleted. High-risk mutation: requires `Idempotency-Key`. */
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

  const requestHash = computeRequestHash({ postId, action: "restore" });
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
      RESTORE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
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

    if (!post || !canRestorePost(post.deletedAt)) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "Blog post not found or not currently soft-deleted."
      );
    }

    const updated = await restoreBlogPost(
      tx,
      tenantId,
      auth.context.tenantUserId,
      postId
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.restored",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "warning",
      message: `Blog post restored: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.post.restored", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId,
      slug: updated.slug
    });

    // ADR-0042 §Rule 21 (Issue #623) — restoring clears `deleted_at`, and the
    // public predicate excludes only on that column, not on status. So a post
    // that was published when it was soft-deleted becomes publicly reachable
    // again the moment this commits, which is a content change like any other.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.post.restored"
    );

    const successResponse = ok(updated);
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
