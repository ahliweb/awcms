import { enqueueModuleContentPurge } from "../../../../../lib/edge-cache/content-purge";
import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  fetchGrantedPermissionKeys,
  resolveModuleEnabled,
  resolveTenantContext
} from "../../../../../modules/identity-access/application/auth-context";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { log } from "../../../../../lib/logging/logger";
import {
  fetchBlogPostById,
  softDeleteBlogPost,
  updateBlogPost
} from "../../../../../modules/blog-content/application/blog-post-directory";
import { createBlogRevision } from "../../../../../modules/blog-content/application/blog-revision-directory";
import {
  countExistingTerms,
  fetchPostTermIds,
  syncPostTermAssignments
} from "../../../../../modules/blog-content/application/blog-taxonomy-directory";
import {
  countExistingInstitutions,
  fetchPostInstitutionIds,
  syncPostInstitutionAssignments
} from "../../../../../modules/blog-content/application/institution-directory";
import { setPostTranslationGroup } from "../../../../../modules/blog-content/application/localized-content-directory";
import { validateNewsMediaReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/news-media-reference-gate";
import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/video-news-thumbnail-reference-gate";
import { mediaLibraryPortAdapter } from "../../../../../modules/media-library/application/media-library-port-adapter";
import {
  validateSoftDeleteBlogPostInput,
  validateUpdateBlogPostInput
} from "../../../../../modules/blog-content/domain/blog-post-validation";
import { validateAndNormalizeContentJsonVideoBlocks } from "../../../../../modules/blog-content/domain/video-news-block-validation";
import { evaluatePostUpdateAccess } from "../../../../../modules/blog-content/domain/post-access-policy";
import { isSignificantContentChange } from "../../../../../modules/blog-content/domain/revision-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read" as const
};

const UPDATE_ACTIVITY = { moduleKey: "blog_content", activityCode: "posts" };

const DELETE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "delete" as const
};

/** `GET /api/v1/blog/posts/{id}` (Issue #538). */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const post = await fetchBlogPostById(tx, tenantId, postId);

    if (!post) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    const termIds = await fetchPostTermIds(tx, tenantId, postId);
    // Sequential, not concurrent: two queries on one transaction connection
    // in parallel leak it.
    const institutionIds = await fetchPostInstitutionIds(tx, tenantId, postId);

    return ok({ ...post, termIds, institutionIds });
  });
};

/**
 * `PATCH /api/v1/blog/posts/{id}` (Issue #538). Access is decided by
 * `evaluatePostUpdateAccess` (doc issue #538 §ABAC Rules: an author may
 * update their own not-yet-published post even without the
 * `blog_content.posts.update` role permission; a role that holds it may
 * update any tenant post) — the post is fetched *before* the decision so
 * `authorTenantUserId`/`status` are real values, same pattern
 * `workflows/tasks/{id}/decisions.ts` uses for its self-approval check.
 * Not idempotent (recommended, not required, per doc issue #538
 * §Idempotency Requirements) — same-body PATCH retries converge to the
 * same end state.
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
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

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateBlogPostInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog post update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;

  // Issue #639 — see `POST /api/v1/blog/posts`'s identical comment. Only
  // runs when `contentJson` is actually present in this partial update.
  if (input.contentJson !== undefined) {
    const videoBlockValidation = validateAndNormalizeContentJsonVideoBlocks(
      input.contentJson
    );

    if (!videoBlockValidation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Blog post update is invalid.",
        {},
        videoBlockValidation.errors
      );
    }

    input.contentJson = videoBlockValidation.value;
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

    // ADR-0063 — the ownership rule is a GRANT BASIS handed to the chokepoint,
    // not a decision taken instead of it, so ABAC (including an explicit deny
    // that overrules ownership), the platform-scope gate and SoD all apply.
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
        ...UPDATE_ACTIVITY,
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

    if (input.termIds && input.termIds.length > 0) {
      const existingCount = await countExistingTerms(
        tx,
        tenantId,
        input.termIds
      );

      if (existingCount !== input.termIds.length) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "termIds contains an id that does not exist for this tenant."
        );
      }
    }

    if (input.institutionIds && input.institutionIds.length > 0) {
      const existingCount = await countExistingInstitutions(
        tx,
        tenantId,
        input.institutionIds
      );

      if (existingCount !== input.institutionIds.length) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "institutionIds contains an id that does not exist for this tenant."
        );
      }
    }

    const mediaReferenceValidation =
      await validateNewsMediaReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        {
          featuredMediaId: input.featuredMediaId,
          seoImageMediaId: input.seoImageMediaId,
          contentJson: input.contentJson
        },
        mediaLibraryPortAdapter
      );

    if (!mediaReferenceValidation.valid) {
      return fail(
        422,
        "NEWS_MEDIA_REFERENCE_INVALID",
        "One or more image references are not valid R2 media objects in full-online R2-only mode.",
        {},
        mediaReferenceValidation.errors
      );
    }

    // Issue #639 — see `POST /api/v1/blog/posts`'s identical comment.
    const videoThumbnailValidation =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        input.contentJson,
        mediaLibraryPortAdapter
      );

    if (!videoThumbnailValidation.valid) {
      return fail(
        422,
        "NEWS_MEDIA_REFERENCE_INVALID",
        "One or more video thumbnail references are not valid R2 media objects in full-online R2-only mode.",
        {},
        videoThumbnailValidation.errors
      );
    }

    let updated;

    try {
      updated = await updateBlogPost(tx, tenantId, postId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_posts_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A post already exists for slug "${input.slug}" in this locale.`
        );
      }

      throw error;
    }

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    if (input.termIds) {
      await syncPostTermAssignments(tx, tenantId, postId, input.termIds);
    }

    if (input.institutionIds) {
      await syncPostInstitutionAssignments(
        tx,
        tenantId,
        postId,
        input.institutionIds
      );
    }

    if (input.translationGroupId !== undefined) {
      await setPostTranslationGroup(
        tx,
        tenantId,
        postId,
        input.translationGroupId
      );
    }

    // Both classifications, because both are WRITABLE here. `institutionIds`
    // was accepted, synced, and then left out of the response — so a client
    // that re-renders from what it got back (which is what the admin screen
    // does) watched the institutions it had just saved disappear, and a second
    // PATCH built from that render would have unassigned them for real.
    const termIds = await fetchPostTermIds(tx, tenantId, postId);
    const institutionIds = await fetchPostInstitutionIds(tx, tenantId, postId);

    if (isSignificantContentChange(input)) {
      await createBlogRevision(
        tx,
        tenantId,
        "post",
        postId,
        context.tenantUserId,
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
        null,
        correlationId
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.updated",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "info",
      message: `Blog post updated: ${updated.slug}.`,
      correlationId
    });

    // ADR-0042: same transaction as the content change, so the invalidation
    // cannot be lost or left behind by a rollback. No-op when the edge
    // cache is disabled.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.post.updated"
    );

    log("info", "blog-content.post.updated", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId,
      slug: updated.slug
    });

    return ok({ ...updated, termIds, institutionIds });
  });
};

/** `DELETE /api/v1/blog/posts/{id}` (Issue #538) — soft-delete. `reason` required, same convention as `DELETE /api/v1/profiles/{id}` and `DELETE /api/v1/email/templates/{id}`. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
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

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSoftDeleteBlogPostInput(bodyRead.value);

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
      DELETE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    if (!validation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required.",
        {},
        validation.errors
      );
    }

    const { reason } = validation.value;

    const deleted = await softDeleteBlogPost(
      tx,
      tenantId,
      auth.context.tenantUserId,
      postId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.deleted",
      resourceType: "blog_post",
      resourceId: postId,
      severity: "warning",
      message: "Blog post deleted.",
      attributes: { reason },
      correlationId
    });

    // ADR-0042: same transaction as the content change, so the invalidation
    // cannot be lost or left behind by a rollback. No-op when the edge
    // cache is disabled.
    await enqueueModuleContentPurge(
      tx,
      tenantId,
      "blog_content",
      "blog.post.deleted"
    );

    log("info", "blog-content.post.deleted", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId
    });

    return ok({ id: postId, deleted: true });
  });
};
