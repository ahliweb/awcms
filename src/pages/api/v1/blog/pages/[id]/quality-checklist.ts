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
 * posts' `awcms_blog_post_terms`).
 *
 * This header used to end by noting that no `POST .../publish` endpoint
 * existed, so nothing blocked a page transition server-side "because no such
 * transition exists to gate". [ADR-0057](../../../../../../../docs/adr/0057-blog-page-lifecycle.md)
 * added the transition, and `pages/{id}/publish.ts` now runs this same
 * checklist as a real gate before it. This route stays what it always was —
 * a read-only preview of the result the editor can see before trying — but it
 * is now a preview OF something rather than a preview of nothing.
 *
 * There is still no `.../schedule`, and there will not be: pages have no
 * `scheduled` state (ADR-0057 §B).
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
