import type { APIRoute } from "astro";

import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../../../lib/auth/session-token";
import { recordAuditEvent } from "../../../../../../../../modules/logging/application/audit-log";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../../modules/_shared/idempotency";
import {
  fetchBlogPostById,
  updateBlogPost
} from "../../../../../../../../modules/blog-content/application/blog-post-directory";
import {
  createBlogRevision,
  fetchBlogRevisionById
} from "../../../../../../../../modules/blog-content/application/blog-revision-directory";
import { validateNewsMediaReferencesForFullOnlineR2Mode } from "../../../../../../../../modules/blog-content/application/news-media-reference-gate";
import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../../../../../../../../modules/blog-content/application/video-news-thumbnail-reference-gate";
import { mediaLibraryPortAdapter } from "../../../../../../../../modules/media-library/application/media-library-port-adapter";
import { validateAndNormalizeContentJsonVideoBlocks } from "../../../../../../../../modules/blog-content/domain/video-news-block-validation";

const RESTORE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "revisions",
  action: "restore" as const
};

const IDEMPOTENCY_SCOPE = "blog_revision_restore";

/**
 * `POST /api/v1/blog/posts/{id}/revisions/{revisionId}/restore` (Issue
 * #541). Requires explicit `blog_content.revisions.restore` permission
 * (doc issue #541 §Revision Rules: "restore requires explicit permission").
 * Restoring never overwrites revision history — it writes the target
 * revision's content back onto the live post (`updateBlogPost`) and then
 * appends a *new* revision snapshotting that write (`createBlogRevision`),
 * so `awcms_blog_revisions` stays append-only (module README §Skema
 * data, point 5). High-risk mutation: requires `Idempotency-Key`.
 */
export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const postId = params.id;
  const revisionId = params.revisionId;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!postId || !revisionId) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Post id and revision id are required."
    );
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

  const requestHash = computeRequestHash({
    postId,
    revisionId,
    action: "restore"
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
      RESTORE_GUARD
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

    const revision = await fetchBlogRevisionById(
      tx,
      tenantId,
      "post",
      postId,
      revisionId
    );

    if (!revision) {
      return fail(404, "RESOURCE_NOT_FOUND", "Revision not found.");
    }

    // Issue #636 (security-auditor finding, PR #666 review): a revision can
    // predate full-online R2-only mode being turned on for this tenant, or
    // can reference a mediaObjectId that has since become unsafe (soft-
    // deleted/orphaned) — restoring it must be re-validated exactly like a
    // live PATCH would be, otherwise `revisions.restore` is a silent
    // bypass of the very validation this issue exists to enforce. Revisions
    // never snapshot `featuredMediaId` (see blog-post-directory.ts's
    // revision-policy exclusion list), so only `contentJson` needs
    // re-checking here.
    const mediaReferenceValidation =
      await validateNewsMediaReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        {
          featuredMediaId: undefined,
          contentJson: revision.contentJson
        },
        mediaLibraryPortAdapter
      );

    if (!mediaReferenceValidation.valid) {
      return fail(
        422,
        "NEWS_MEDIA_REFERENCE_INVALID",
        "This revision references image(s) that are not valid R2 media objects in full-online R2-only mode and cannot be restored.",
        {},
        mediaReferenceValidation.errors
      );
    }

    // Issue #639 — same "restore must re-validate exactly like a live PATCH
    // would" reasoning as the #636 comment above, extended to `video_news`
    // blocks: (1) unconditional structural re-validation (a revision from
    // before this issue existed cannot contain a `video_news` block at all,
    // but this stays correct for any FUTURE revision that does), and (2)
    // the R2-only-mode-gated thumbnail reference check.
    const videoBlockValidation = validateAndNormalizeContentJsonVideoBlocks(
      revision.contentJson
    );

    if (!videoBlockValidation.valid) {
      return fail(
        422,
        "NEWS_MEDIA_REFERENCE_INVALID",
        "This revision contains an invalid video_news block and cannot be restored.",
        {},
        videoBlockValidation.errors
      );
    }

    const normalizedContentJson = videoBlockValidation.value;

    const videoThumbnailValidation =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        normalizedContentJson,
        mediaLibraryPortAdapter
      );

    if (!videoThumbnailValidation.valid) {
      return fail(
        422,
        "NEWS_MEDIA_REFERENCE_INVALID",
        "This revision references video thumbnail(s) that are not valid R2 media objects in full-online R2-only mode and cannot be restored.",
        {},
        videoThumbnailValidation.errors
      );
    }

    const updated = await updateBlogPost(tx, tenantId, postId, {
      title: revision.title,
      contentJson: normalizedContentJson,
      contentText: revision.contentText,
      excerpt: revision.excerpt,
      seoTitle: revision.seoTitle,
      metaDescription: revision.metaDescription,
      canonicalUrl: revision.canonicalUrl
    });

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

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
        excerpt: updated.excerpt,
        seoTitle: updated.seoTitle,
        metaDescription: updated.metaDescription,
        canonicalUrl: updated.canonicalUrl,
        status: updated.status
      },
      `Restored from revision ${revision.revisionNumber}.`,
      correlationId
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.revision_restored",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "warning",
      message: `Blog post restored from revision ${revision.revisionNumber}: ${updated.slug}.`,
      attributes: { revisionId, revisionNumber: revision.revisionNumber },
      correlationId
    });

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
