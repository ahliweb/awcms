import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { searchBlogContentAdmin } from "../../../../../modules/blog-content/application/blog-search";
import { isBlogContentStatus } from "../../../../../modules/blog-content/domain/post-status";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";

const READ_GUARD = {
  moduleKey: "blog_content",
  activityCode: "search",
  action: "read" as const
};

/**
 * `GET /api/v1/blog/search` (Issue #539) — admin full-text search across
 * posts and pages, guarded by `blog_content.search.read`. May return
 * content of any status (doc issue #539: "Admin search may include
 * draft/review/scheduled/published/archived content according to
 * permission" — the single `search.read` permission gates that, no
 * further per-status composition). Keyset-paginated
 * (`_shared/keyset-pagination.ts`, same `(created_at, id)` convention
 * `GET /api/v1/logs/audit` uses).
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const query = url.searchParams.get("q");

  if (!query || query.trim().length === 0) {
    return fail(400, "VALIDATION_ERROR", "q is required.");
  }

  const resourceTypeParam = url.searchParams.get("type");
  if (
    resourceTypeParam !== null &&
    resourceTypeParam !== "post" &&
    resourceTypeParam !== "page"
  ) {
    return fail(400, "VALIDATION_ERROR", "type must be one of post, page.");
  }

  const statusParam = url.searchParams.get("status");
  if (statusParam !== null && !isBlogContentStatus(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status must be one of draft, review, scheduled, published, archived."
    );
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
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

      const result = await searchBlogContentAdmin(tx, tenantId, {
        query: query.trim(),
        resourceType: resourceTypeParam ?? undefined,
        status: statusParam ?? undefined,
        cursor: cursor ?? undefined,
        limit
      });

      return ok(result);
    },
    { workClass: "reporting" }
  );
};
