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
import { recordDecisionLog } from "../../../../../modules/identity-access/application/decision-log";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  fetchBlogPageById,
  softDeleteBlogPage,
  updateBlogPage
} from "../../../../../modules/blog-content/application/blog-page-directory";
import { createBlogRevision } from "../../../../../modules/blog-content/application/blog-revision-directory";
import { validateNewsMediaReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/news-media-reference-gate";
import { validateVideoNewsThumbnailReferencesForFullOnlineR2Mode } from "../../../../../modules/blog-content/application/video-news-thumbnail-reference-gate";
import { newsMediaPortAdapter } from "../../../../../modules/news-portal/application/news-media-port-adapter";
import {
  validateSoftDeleteBlogPageInput,
  validateUpdateBlogPageInput
} from "../../../../../modules/blog-content/domain/blog-page-validation";
import { validateAndNormalizeContentJsonVideoBlocks } from "../../../../../modules/blog-content/domain/video-news-block-validation";
import { evaluatePageUpdateAccess } from "../../../../../modules/blog-content/domain/page-access-policy";
import { isSignificantContentChange } from "../../../../../modules/blog-content/domain/revision-policy";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "read" as const
};

const UPDATE_ACTIVITY = { moduleKey: "blog_content", activityCode: "pages" };

const DELETE_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "delete" as const
};

/** `GET /api/v1/blog/pages/{id}` (Issue #539). */
export const GET: APIRoute = async ({ request, params, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const pageId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!pageId) {
    return fail(400, "VALIDATION_ERROR", "Page id is required.");
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

    const page = await fetchBlogPageById(tx, tenantId, pageId);

    if (!page) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    return ok(page);
  });
};

/**
 * `PATCH /api/v1/blog/pages/{id}` (Issue #539). Access decided by
 * `evaluatePageUpdateAccess` — same author-own-unpublished-content
 * override `PATCH /api/v1/blog/posts/{id}` uses, fixed to
 * `blog_content.pages.update` (doc issue #539: "must follow the same
 * auth, tenant, RBAC/ABAC, ... patterns introduced in the blog post
 * API").
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const pageId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!pageId) {
    return fail(400, "VALIDATION_ERROR", "Page id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request, "large");

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateBlogPageInput(bodyRead.value, pageId);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Blog page update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;

  // Issue #639 — see `POST /api/v1/blog/pages`'s identical comment. Only
  // runs when `contentJson` is actually present in this partial update.
  if (input.contentJson !== undefined) {
    const videoBlockValidation = validateAndNormalizeContentJsonVideoBlocks(
      input.contentJson
    );

    if (!videoBlockValidation.valid) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Blog page update is invalid.",
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

    const page = await fetchBlogPageById(tx, tenantId, pageId);

    if (!page) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    const grantedPermissionKeys = await fetchGrantedPermissionKeys(
      tx,
      tenantId,
      context.tenantUserId
    );
    const decision = evaluatePageUpdateAccess(context, grantedPermissionKeys, {
      authorTenantUserId: page.authorTenantUserId,
      status: page.status
    });

    await recordDecisionLog(
      tx,
      tenantId,
      context.tenantUserId,
      {
        ...UPDATE_ACTIVITY,
        action: "update",
        resourceType: "blog_page",
        resourceId: pageId
      },
      decision
    );

    if (!decision.allowed) {
      return fail(403, "ACCESS_DENIED", decision.reason);
    }

    if (input.parentPageId) {
      if (input.parentPageId === pageId) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "A page cannot be its own parent."
        );
      }

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

    // Issue #639 — see `POST /api/v1/blog/pages`'s identical comment.
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

    let updated;

    try {
      updated = await updateBlogPage(tx, tenantId, pageId, input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("awcms_blog_pages_slug_dedup")) {
        return fail(
          409,
          "SLUG_CONFLICT",
          `A page already exists for slug "${input.slug}" in this locale.`
        );
      }

      throw error;
    }

    if (!updated) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    if (isSignificantContentChange(input)) {
      await createBlogRevision(
        tx,
        tenantId,
        "page",
        pageId,
        context.tenantUserId,
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
        null,
        correlationId
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.updated",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "info",
      message: `Blog page updated: ${updated.slug}.`,
      correlationId
    });

    return ok(updated);
  });
};

/** `DELETE /api/v1/blog/pages/{id}` (Issue #539) — soft-delete. `reason` required, same convention as posts. */
export const DELETE: APIRoute = async ({
  request,
  params,
  cookies,
  locals
}) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const pageId = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!pageId) {
    return fail(400, "VALIDATION_ERROR", "Page id is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSoftDeleteBlogPageInput(bodyRead.value);

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

    const deleted = await softDeleteBlogPage(
      tx,
      tenantId,
      auth.context.tenantUserId,
      pageId,
      reason
    );

    if (!deleted) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog page not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "blog_content",
      action: "blog.page.deleted",
      resourceType: "blog_page",
      resourceId: pageId,
      severity: "warning",
      message: "Blog page deleted.",
      attributes: { reason },
      correlationId
    });

    return ok({ id: pageId, deleted: true });
  });
};
