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
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import { log } from "../../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import {
  fetchBlogPostById,
  transitionBlogPostStatus
} from "../../../../../../modules/blog-content/application/blog-post-directory";
import { isValidStatusTransition } from "../../../../../../modules/blog-content/domain/post-status";
import { validateScheduleBlogPostInput } from "../../../../../../modules/blog-content/domain/blog-post-validation";
import { fetchPostTermIds } from "../../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { fetchBlogSettings } from "../../../../../../modules/blog-content/application/blog-settings-directory";
import {
  checklistBlockersToErrorDetails,
  evaluateContentQualityChecklistForContent
} from "../../../../../../modules/blog-content/application/content-quality-checklist-gate";
import { mediaLibraryPortAdapter } from "../../../../../../modules/media-library/application/media-library-port-adapter";

const SCHEDULE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "schedule" as const
};

const IDEMPOTENCY_SCOPE = "blog_post_schedule";

/**
 * `POST /api/v1/blog/posts/{id}/schedule` (Issue #538). Body:
 * `{ scheduledAt: <ISO 8601 datetime, future>, unpublishAt?: <ISO 8601 datetime> | null }`.
 * High-risk mutation: requires `Idempotency-Key`.
 *
 * `unpublishAt` (Issue #591) closes the publication window. It is carried in
 * the idempotency request hash alongside `scheduledAt`, so re-sending the same
 * key with a DIFFERENT withdrawal date is a 409 rather than a silent no-op —
 * two different windows are two different requests.
 *
 * ## No edge-cache purge here, deliberately (Issue #623)
 *
 * The other four lifecycle routes gained one; this one did not, and the reason
 * is `ALLOWED_STATUS_TRANSITIONS`: only `draft` and `review` may become
 * `scheduled`, and a published post cannot. So nothing this route commits is
 * ever visible on a public surface — before or after — and the transition that
 * DOES make it visible is `blog-scheduled-publish.ts`'s sweep, which purges.
 *
 * Adding one anyway would append a ban that matches no cached object while the
 * queue reports success: the same "ceremony that reads as coverage" this repo
 * already refuses for surfaceless module keys in `resolveDerivedSurfaceModuleKeys`.
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateScheduleBlogPostInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Schedule input is invalid.",
      {},
      validation.errors
    );
  }

  const { scheduledAt, unpublishAt } = validation.value;
  const requestHash = computeRequestHash({
    postId,
    action: "schedule",
    scheduledAt: scheduledAt.toISOString(),
    unpublishAt: unpublishAt?.toISOString() ?? null
  });
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
      SCHEDULE_GUARD
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

    const post = await fetchBlogPostById(tx, tenantId, postId);

    if (!post) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    if (!isValidStatusTransition(post.status, "scheduled")) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot schedule a post in status "${post.status}".`
      );
    }

    // Issue #640: same server-side content quality checklist gate as
    // publish — scheduling is also a "publish state transition" the issue's
    // security notes require validating before, not just at the moment the
    // scheduled-publish worker later flips it to `published`.
    const termIds = await fetchPostTermIds(tx, tenantId, postId);
    const blogSettings = await fetchBlogSettings(tx, tenantId);
    const checklist = await evaluateContentQualityChecklistForContent(
      tx,
      tenantId,
      "post",
      post,
      termIds.length,
      mediaLibraryPortAdapter,
      blogSettings.contentQualityChecklistPolicy,
      {
        scheduledAt,
        socialPreviewFallback: {
          tenantFallbackImageMediaId:
            blogSettings.socialPreviewFallbackImageMediaId,
          contentImageFallbackEnabled:
            blogSettings.socialPreviewContentImageFallbackEnabled
        }
      }
    );

    if (!checklist.passed) {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "blog_content",
        action: "blog.post.schedule_blocked_by_checklist",
        resourceType: "blog_post",
        resourceId: postId,
        severity: "warning",
        message: `Blog post schedule blocked by content quality checklist: ${post.slug}.`,
        attributes: {
          blockedRuleIds: checklist.blockers.map((blocker) => blocker.ruleId)
        },
        correlationId
      });

      return fail(
        422,
        "CONTENT_QUALITY_CHECKLIST_BLOCKED",
        "Scheduling is blocked by the content quality checklist.",
        {},
        checklistBlockersToErrorDetails(checklist)
      );
    }

    const updated = await transitionBlogPostStatus(
      tx,
      tenantId,
      postId,
      "scheduled",
      { scheduledAt, unpublishAt }
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.scheduled",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "info",
      message: `Blog post scheduled: ${updated.slug}.`,
      attributes: {
        scheduledAt: scheduledAt.toISOString(),
        unpublishAt: unpublishAt?.toISOString() ?? null
      },
      correlationId
    });

    log("info", "blog-content.post.scheduled", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId,
      slug: updated.slug,
      scheduledAt: scheduledAt.toISOString(),
      unpublishAt: unpublishAt?.toISOString() ?? null
    });

    const successResponse = ok({ ...updated, qualityChecklist: checklist });
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
