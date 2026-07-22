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
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createBlogPage,
  listBlogPages
} from "../../../../../modules/blog-content/application/blog-page-directory";
import { validateNewsMediaReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/news-media-reference-gate";
import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/video-news-thumbnail-reference-gate";
import { noopNewsMediaPortAdapter } from "../../../../../modules/blog-content/application/news-media-port-noop-adapter";
import { validateCreateBlogPageInput } from "../../../../../modules/blog-content/domain/blog-page-validation";
import { validateAndNormalizeContentJsonVideoBlocks } from "../../../../../modules/blog-content/domain/video-news-block-validation";
import {
  isBlogContentStatus,
  type BlogContentStatus
} from "../../../../../modules/blog-content/domain/post-status";
import {
  isPageType,
  type PageType
} from "../../../../../modules/blog-content/domain/page-type";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "read" as const
};

const CREATE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "create" as const
};

/** `GET /api/v1/blog/pages` (Issue #539) — list this tenant's non-deleted pages, `?status=`/`?pageType=` optional filters, `?limit=` bounded (default 20, max 100). */
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

  const pageTypeParam = url.searchParams.get("pageType");
  let pageType: PageType | undefined;

  if (pageTypeParam !== null) {
    if (!isPageType(pageTypeParam)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "pageType must be one of standard, landing, legal, system."
      );
    }

    pageType = pageTypeParam;
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

    const pages = await listBlogPages(tx, tenantId, {
      status,
      pageType,
      limit
    });

    return ok({ pages });
  });
};

/** `POST /api/v1/blog/pages` (Issue #539) — create a draft page. Not idempotent (same reasoning as `POST /api/v1/blog/posts`) — a retry duplicating a create is caught by the `(tenant_id, locale, slug)` partial unique index. */
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

  const validation = validateCreateBlogPageInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog page is invalid.",
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
      "Blog page is invalid.",
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

    if (input.parentPageId) {
      const parentRows = await tx`
        SELECT id FROM awcms_blog_pages
        WHERE tenant_id = ${tenantId} AND id = ${input.parentPageId} AND deleted_at IS NULL
      `;

      if (parentRows.length === 0) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "parentPageId does not reference an existing page."
        );
      }
    }

    const mediaReferenceValidation =
      await validateNewsMediaReferencesForFullOnlineR2Mode(
        tx,
        tenantId,
        {
          featuredMediaId: input.featuredMediaId,
          contentJson: input.contentJson
        },
        noopNewsMediaPortAdapter
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
        noopNewsMediaPortAdapter
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

    let page;

    try {
      page = await createBlogPage(
        tx,
        tenantId,
        auth.context.tenantUserId,
        input
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_pages_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A page already exists for slug "${input.slug}" in locale "${input.locale}".`
        );
      }

      throw error;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.created",
      resourceType: "blog_page",
      resourceId: page.id,
      severity: "info",
      message: `Blog page created: ${page.slug}.`,
      correlationId
    });

    return ok(page);
  });
};
