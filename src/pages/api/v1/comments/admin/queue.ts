import type { APIRoute } from "astro";

import { hashSessionToken } from "../../../../../lib/auth/session-token";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { listModerationQueue } from "../../../../../modules/comments/application/comment-moderation";
import {
  COMMENTS_MODERATION_ACTIVITY_CODE,
  COMMENTS_MODULE_KEY
} from "../../../../../modules/comments/domain/comments-permissions";
import type { CommentStatus } from "../../../../../modules/comments/domain/comment-status";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";

/**
 * `GET /api/v1/comments/admin/queue` — the ABAC-guarded moderation queue (ADR-0041,
 * ported from awcms-micro Issue #271). Status-filtered, keyset-paginated. This is the ONLY surface
 * that exposes moderation metadata (reason codes, masked email, report counts).
 */
const READ_GUARD = {
  moduleKey: COMMENTS_MODULE_KEY,
  activityCode: COMMENTS_MODERATION_ACTIVITY_CODE,
  action: "read" as const
};

const VALID_STATUSES: readonly CommentStatus[] = [
  "pending",
  "approved",
  "rejected",
  "spam",
  "deleted"
];

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  const statusParam = url.searchParams.get("status");
  const status =
    statusParam && VALID_STATUSES.includes(statusParam as CommentStatus)
      ? (statusParam as CommentStatus)
      : null;
  // Full-precision cursor pair — see `listModerationQueue` on why the timestamp
  // travels as text rather than as a Date.
  const cursorCreatedAt = url.searchParams.get("cursor");
  const cursorId = url.searchParams.get("cursorId");
  const limit = Number(url.searchParams.get("limit") ?? 25);

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const result = await listModerationQueue(tx, tenantId, {
      status,
      limit: Number.isFinite(limit) ? limit : 25,
      beforeCreatedAt: cursorCreatedAt,
      beforeId: cursorId
    });
    return ok(result);
  });
};
