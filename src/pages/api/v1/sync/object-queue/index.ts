import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchObjectQueueEntries } from "../../../../../modules/sync-storage/application/sync-directory";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";

const READ_GUARD = {
  moduleKey: "sync_storage",
  activityCode: "object_queue",
  action: "read" as const
};

const VALID_STATUS_FILTERS = new Set(["pending", "sent", "failed"]);

/**
 * Admin-facing (session-authenticated), tenant-wide object sync queue view —
 * distinct from the node-scoped, HMAC-authenticated `GET /sync/objects/status`
 * that a single node polls for its own pending work.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusParam = url.searchParams.get("status");

  if (statusParam !== null && !VALID_STATUS_FILTERS.has(statusParam)) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "status must be one of pending, sent, failed."
    );
  }

  const cursorParam = url.searchParams.get("cursor");
  const cursor = cursorParam ? decodeKeysetCursor(cursorParam) : null;

  if (cursorParam && !cursor) {
    return fail(400, "VALIDATION_ERROR", "cursor is malformed.");
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

    const { objects, nextCursor } = await fetchObjectQueueEntries(
      tx,
      tenantId,
      (statusParam as "pending" | "sent" | "failed" | null) ?? undefined,
      cursor ?? undefined
    );

    return ok({ objects, nextCursor });
  });
};
