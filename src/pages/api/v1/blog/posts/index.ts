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
import { log } from "../../../../../lib/logging/logger";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createBlogPost,
  listBlogPosts
} from "../../../../../modules/blog-content/application/blog-post-directory";
import {
  countExistingTerms,
  syncPostTermAssignments
} from "../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { setPostTranslationGroup } from "../../../../../modules/blog-content/application/localized-content-directory";
import { validateNewsMediaReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/news-media-reference-gate";
import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/video-news-thumbnail-reference-gate";
import { newsMediaPortAdapter } from "../../../../../modules/news-portal/application/news-media-port-adapter";
import { validateCreateBlogPostInput } from "../../../../../modules/blog-content/domain/blog-post-validation";
import { validateAndNormalizeContentJsonVideoBlocks } from "../../../../../modules/blog-content/domain/video-news-block-validation";
import {
  isBlogContentStatus,
  type BlogContentStatus
} from "../../../../../modules/blog-content/domain/post-status";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "create" as const
};

/** `GET /api/v1/blog/posts` (Issue #538) — list this tenant's non-deleted posts, `?status=` optional filter, `?limit=` bounded (default 20, max 100). */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status");
  let status: BlogContentStatus | undefined;

  if (statusParam !== null) {
    if (!isBlogContentStatus(statusParam)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "status must be one of draft, review, scheduled, published, archived."
      );
    }

    status = statusParam;
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  if (
    limitParam !== null &&
    (!Number.isFinite(limit) || (limit as number) < 1)
  ) {
    return fail(400, "VALIDATION_ERROR", "limit must be a positive number.");
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

    const posts = await listBlogPosts(tx, tenantId, {
      status,
      limit
    });

    return ok({ posts });
  });
};

/** `POST /api/v1/blog/posts` (Issue #538) — create a draft post. Not idempotent (recommended, not required, per doc issue #538 §Idempotency Requirements) — a network retry duplicating a create is caught by the `(tenant_id, locale, slug)` partial unique index, same reasoning `POST /api/v1/email/templates` documents. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateCreateBlogPostInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog post is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;

  // Issue #639 — unconditional (not R2-only-mode-gated), pure structural
  // validation/normalization of any `video_news` blocks in `contentJson`:
  // provider allowlist, videoId format/normalization. Runs before
  // `withTenant` since it needs no database access.
  const videoBlockValidation = validateAndNormalizeContentJsonVideoBlocks(
    input.contentJson
  );

  if (!videoBlockValidation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog post is invalid.",
      {},
      videoBlockValidation.errors
    );
  }

  input.contentJson = videoBlockValidation.value;

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
      CREATE_GUARD
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

    const mediaReferenceValidation =
      await validateNewsMediaReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        {
          featuredMediaId: input.featuredMediaId,
          seoImageMediaId: input.seoImageMediaId,
          contentJson: input.contentJson
        },
        newsMediaPortAdapter
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

    // Issue #639 — mode-gated (same as above): a `video_news` block's
    // optional `thumbnailMediaObjectId`, when present, must be a verified
    // same-tenant R2 media object in full-online R2-only mode.
    const videoThumbnailValidation =
      await validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        input.contentJson,
        newsMediaPortAdapter
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

    let post;

    try {
      post = await createBlogPost(
        tx,
        tenantId,
        auth.context.tenantUserId,
        input
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_posts_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A post already exists for slug "${input.slug}" in locale "${input.locale}".`
        );
      }

      throw error;
    }

    if (input.termIds) {
      await syncPostTermAssignments(tx, tenantId, post.id, input.termIds);
    }

    if (input.translationGroupId) {
      await setPostTranslationGroup(
        tx,
        tenantId,
        post.id,
        input.translationGroupId
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.post.created",
      resourceType: "blog_post",
      resourceId: post.id,
      severity: "info",
      message: `Blog post created: ${post.slug}.`,
      correlationId
    });

    log("info", "blog-content.post.created", {
      correlationId,
      tenantId,
      moduleKey: "blog_content",
      postId: post.id,
      slug: post.slug
    });

    return ok({ ...post, termIds: input.termIds ?? [] });
  });
};
