import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import { fetchBlogPostById } from "../../../../../../../modules/blog-content/application/blog-post-directory";
import { renderContentJsonToHtml } from "../../../../../../../modules/blog-content/domain/content-block-rendering";
import { previewInternalTagLinksForContent } from "../../../../../../../modules/blog-content/application/internal-tag-link-rendering";
import { resolveBlogAutoInternalTagLinksConfig } from "../../../../../../../modules/blog-content/domain/internal-tag-linking-config";

const PREVIEW_GUARD = {
  moduleKey: "blog_content",
  activityCode: "internal_links",
  action: "preview" as const
};

/**
 * `GET /api/v1/blog/posts/{id}/internal-links/preview` (Issue #641) —
 * read-only preview of which terms would be automatically linked in this
 * post's rendered content BEFORE publishing (acceptance criterion "Preview
 * endpoint/UI shows which terms will be linked before publish"). Runs the
 * exact same `applyInternalTagLinksToHtml` engine the public `/news`/
 * `/blog/{tenantCode}` routes use at render time (via
 * `previewInternalTagLinksForContent`), against the post's CURRENT
 * `content_json` regardless of its `status` (draft/review/scheduled all
 * previewable — that's the point) — gallery/video media is rendered
 * without R2 resolution (media verification is `content-quality-checklist`'s
 * concern, Issue #640; this endpoint only cares about which text terms
 * would be linked, and figure/figcaption/embed exclusion works identically
 * whether or not a gallery image URL actually resolved).
 *
 * PORT ADAPTATION: awcms-mini built the preview's tag-archive link base path
 * from `EffectivePublicRouteSettings.publicBasePath` (the `/news` family's
 * own setting) — dropped in this port along with `/news` itself (see
 * `blog-content/module.ts`'s description field). The one ported public
 * route family is `/blog/{tenantCode}`, so this preview now looks up the
 * tenant's own `tenant_code` and builds `/blog/{tenantCode}` directly —
 * the preview link an editor sees here now matches EXACTLY what the public
 * route renders, which is strictly more accurate than mini's own
 * `/news`-based preview ever was for a tenant using the legacy family.
 */
type TenantCodeRow = { tenant_code: string };
export const GET: APIRoute = async ({ request, cookies, params }) => {
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

  return withTenant(sql, tenantId, async (tx: Bun.SQL) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      PREVIEW_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const post = await fetchBlogPostById(tx, tenantId, postId);

    if (!post) {
      return fail(404, "NOT_FOUND", "Blog post not found.");
    }

    const tenantRows = (await tx`
      SELECT tenant_code FROM awcms_tenants WHERE id = ${tenantId}
    `) as TenantCodeRow[];
    const basePath = `/blog/${tenantRows[0]?.tenant_code ?? ""}`;
    const contentHtml = renderContentJsonToHtml(post.contentJson);

    const preview = await previewInternalTagLinksForContent(
      tx,
      tenantId,
      contentHtml,
      post.autoInternalTagLinksDisabled,
      basePath
    );

    const deploymentConfig = resolveBlogAutoInternalTagLinksConfig();

    return ok({
      postId: post.id,
      enabled: preview.enabled,
      disabledReason: preview.disabledReason,
      matches: preview.result.matches,
      totalLinked: preview.result.matches.length,
      maxPerPost: deploymentConfig.maxPerPost,
      maxPerTag: deploymentConfig.maxPerTag
    });
  });
};
