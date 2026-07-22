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
import { fetchBlogRevisionById } from "../../../../../../../modules/blog-content/application/blog-revision-directory";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "revisions",
  action: "read" as const
};

/**
 * `GET /api/v1/blog/posts/{id}/revisions/{revisionId}` (Issue #541).
 * Requires `blog_content.revisions.read`. 404 (not 403) if the revision
 * exists but belongs to a different post/tenant — `fetchBlogRevisionById`
 * scopes on `resource_id` in addition to `id`, so cross-tenant/cross-post
 * access is indistinguishable from "doesn't exist", same convention every
 * other resource lookup in this module already uses.
 */
export const GET: APIRoute = async ({ request, params, cookies }) => {
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

    return ok(revision);
  });
};
