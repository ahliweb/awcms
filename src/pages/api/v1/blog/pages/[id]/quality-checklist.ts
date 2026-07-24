import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { fetchBlogPageById } from "../../../../../../modules/blog-content/application/blog-page-directory";
import { fetchBlogSettings } from "../../../../../../modules/blog-content/application/blog-settings-directory";
import { evaluateContentQualityChecklistForContent } from "../../../../../../modules/blog-content/application/content-quality-checklist-gate";
import { mediaLibraryPortAdapter } from "../../../../../../modules/media-library/application/media-library-port-adapter";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "pages",
  action: "read" as const
};

/**
 * `GET /api/v1/blog/pages/{id}/quality-checklist` (Issue #640). Read-only
 * preview for the admin page editor, mirroring `posts/{id}/quality-
 * checklist.ts` exactly — see that file's header for the full rationale.
 * `taxonomy_exists` is always reported non-applicable for pages
 * (`awcms_blog_pages` has no category/tag assignment table, unlike
 * posts' `awcms_blog_post_terms`). There is currently no
 * `POST /api/v1/blog/pages/{id}/publish` or `.../schedule` endpoint in this
 * codebase at all — pages are created directly in `status = 'draft'` with
 * no lifecycle-transition route (a pre-existing gap, out of this issue's
 * atomic scope to add). This endpoint is therefore preview-only for pages:
 * it reports the same checklist a page WOULD need to pass, but nothing
 * currently blocks a page transition server-side because no such
 * transition exists to gate.
 */
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

    const blogSettings = await fetchBlogSettings(tx, tenantId);
    const checklist = await evaluateContentQualityChecklistForContent(
      tx,
      tenantId,
      "page",
      page,
      0,
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

    return ok({ pageId, qualityChecklist: checklist });
  });
};
