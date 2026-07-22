import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { fetchBlogPostById } from "../../../../../../modules/blog-content/application/blog-post-directory";
import { fetchPostTermIds } from "../../../../../../modules/blog-content/application/blog-taxonomy-directory";
import { fetchBlogSettings } from "../../../../../../modules/blog-content/application/blog-settings-directory";
import { evaluateContentQualityChecklistForContent } from "../../../../../../modules/blog-content/application/content-quality-checklist-gate";
import { newsMediaPortAdapter } from "../../../../../../modules/news-portal/application/news-media-port-adapter";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read" as const
};

/**
 * `GET /api/v1/blog/posts/{id}/quality-checklist` (Issue #640). Read-only
 * preview of the content quality checklist for the admin post editor —
 * acceptance criterion "Checklist is available in admin post/page editor."
 * Same read permission as `GET /api/v1/blog/posts/{id}` (no separate
 * permission needed, this exposes no new capability beyond reading the
 * post itself). Never mutates anything; the actual server-side enforcement
 * happens at `POST .../publish` and `POST .../schedule`, which run the
 * exact same evaluator (`content-quality-checklist-gate.ts`) — this
 * endpoint exists purely so the editor can show the same result BEFORE the
 * author attempts either action.
 */
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
    const blogSettings = await fetchBlogSettings(tx, tenantId);
    const checklist = await evaluateContentQualityChecklistForContent(
      tx,
      tenantId,
      "post",
      post,
      termIds.length,
      newsMediaPortAdapter,
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

    return ok({ postId, qualityChecklist: checklist });
  });
};
