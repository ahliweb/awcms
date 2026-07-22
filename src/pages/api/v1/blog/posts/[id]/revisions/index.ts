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
import { listBlogRevisions } from "../../../../../../../modules/blog-content/application/blog-revision-directory";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "revisions",
  action: "read" as const
};

/**
 * `GET /api/v1/blog/posts/{id}/revisions` (Issue #541). Requires
 * `blog_content.revisions.read` — no ownership carve-out (unlike `PATCH
 * .../{id}`, doc issue #541 §Permission Mapping lists this as a plain
 * permission-gated read, not an ABAC-composed one). `?limit=` bounded
 * (default 20, max 100), newest revision first.
 */
export const GET: APIRoute = async ({ request, params, cookies, url }) => {
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

    const post = await fetchBlogPostById(tx, tenantId, postId, {
      includeDeleted: true
    });

    if (!post) {
      return fail(404, "RESOURCE_NOT_FOUND", "Blog post not found.");
    }

    const revisions = await listBlogRevisions(tx, tenantId, "post", postId, {
      limit
    });

    return ok({ revisions });
  });
};
