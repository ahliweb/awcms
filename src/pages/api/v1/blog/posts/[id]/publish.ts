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
import { createBlogRevision } from "../../../../../../modules/blog-content/application/blog-revision-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord,
  userIdempotencyActor
} from "../../../../../../modules/_shared/idempotency";
import {
  fetchBlogPostById,
  transitionBlogPostStatus
} from "../../../../../../modules/blog-content/application/blog-post-directory";
import { isValidStatusTransition } from "../../../../../../modules/blog-content/domain/post-status";
import { fetchPostTermIds } from "../../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { fetchBlogSettings } from "../../../../../../modules/blog-content/application/blog-settings-directory";
import {
  checklistBlockersToErrorDetails,
  evaluateContentQualityChecklistForContent
} from "../../../../../../modules/blog-content/application/content-quality-checklist-gate";
import { mediaLibraryPortAdapter } from "../../../../../../modules/media-library/application/media-library-port-adapter";
import { noopSocialPublishingPortAdapter } from "../../../../../../modules/blog-content/application/social-publishing-port-noop-adapter";
import { resolveSocialPublishingPort } from "../../../../../../modules/social-publishing/application/social-publishing-port-adapter";

// This route is the composition root that wires `social_publishing`'s real
// `SocialPublishingPort` into the manual publish action (trigger
// `post_published`) — but ONLY when the deployment enables the module
// (`SOCIAL_PUBLISHING_ENABLED`, ADR-0157 section 7). Otherwise it is
// `blog_content`'s own no-op, exactly as before the module existed, so a
// deployment that configures nothing behaves byte for byte the same.
const socialPublishingPort = resolveSocialPublishingPort(
  noopSocialPublishingPortAdapter,
  mediaLibraryPortAdapter
);

const PUBLISH_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "publish" as const
};

const IDEMPOTENCY_SCOPE = "blog_post_publish";

/**
 * `POST /api/v1/blog/posts/{id}/publish` (Issue #538). Straightforward
 * permission gate — doc issue #538 §ABAC Rules: "Author may not publish
 * unless granted `blog_content.posts.publish`" (no ownership carve-out
 * like `PATCH .../{id}` has for `update`). High-risk mutation: requires
 * `Idempotency-Key` (same replay/conflict semantics as
 * `workflows/tasks/{id}/decisions.ts`).
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

  const requestHash = computeRequestHash({ postId, action: "publish" });
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
      PUBLISH_GUARD
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
      idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId)
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

    if (!isValidStatusTransition(post.status, "published")) {
      return fail(
        409,
        "INVALID_STATUS_TRANSITION",
        `Cannot publish a post in status "${post.status}".`
      );
    }

    // Issue #640: content quality checklist — server-side gate BEFORE the
    // publish state transition, never relying on a client-side check alone.
    // A no-op (`applicable: false`) when full-online R2-only mode isn't
    // active for this tenant, same mode-gating precedent Issue #636 set.
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
        action: "blog.post.publish_blocked_by_checklist",
        resourceType: "blog_post",
        resourceId: postId,
        severity: "warning",
        message: `Blog post publish blocked by content quality checklist: ${post.slug}.`,
        attributes: {
          blockedRuleIds: checklist.blockers.map((blocker) => blocker.ruleId)
        },
        correlationId
      });

      return fail(
        422,
        "CONTENT_QUALITY_CHECKLIST_BLOCKED",
        "Publish is blocked by the content quality checklist.",
        {},
        checklistBlockersToErrorDetails(checklist)
      );
    }

    const updated = await transitionBlogPostStatus(
      tx,
      tenantId,
      postId,
      "published"
    );

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    // Snapshot the content AS PUBLISHED, in the same transaction as the
    // transition: without it the sequence create -> publish -> edit leaves only
    // the post-edit text in history and the version readers saw is lost. A
    // `published -> published` republish of unchanged content writes one too.
    await createBlogRevision(
      tx,
      tenantId,
      "post",
      postId,
      auth.context.tenantUserId,
      {
        title: updated.title,
        contentJson: updated.contentJson,
        contentText: updated.contentText,
        bodyPortableText: updated.bodyPortableText,
        excerpt: updated.excerpt,
        seoTitle: updated.seoTitle,
        metaDescription: updated.metaDescription,
        canonicalUrl: updated.canonicalUrl,
        status: updated.status
      },
      "Published.",
      correlationId
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.published",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "info",
      message: `Blog post published: ${updated.slug}.`,
      correlationId
    });

    log("info", "blog-content.post.published", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId,
      slug: updated.slug
    });

    // ADR-0042 §Rule 21 (Issue #623) — this is the button `/admin/blog` calls,
    // and the transition it performs is the one a stale cache hides. The PATCH
    // path purged and this did not, so with the edge cache on, publishing an
    // article emitted nothing and the newsroom waited out a 120-second TTL
    // wondering whether the publish had worked. Same transaction as the status
    // change, no-op when the cache is off.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.post.published"
    );

    await socialPublishingPort.onArticlePublished(
      tx,
      tenantId,
      {
        articleId: postId,
        title: updated.title,
        slug: updated.slug,
        excerpt: updated.excerpt,
        featuredMediaId: updated.featuredMediaId,
        trigger: "post_published"
      },
      correlationId
    );

    const successResponse = ok({ ...updated, qualityChecklist: checklist });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      userIdempotencyActor(auth.context.tenantUserId),
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
