import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { fetchSyncNodes } from "../../../../../modules/sync-storage/application/sync-directory";

const READ_GUARD = {
  moduleKey: "sync_storage",
  activityCode: "node_management",
  action: "read" as const
};

/**
 * Admin-facing (session-authenticated) list of sync nodes for the tenant —
 * distinct from the HMAC node-to-node endpoints (`/sync/push`, `/sync/pull`,
 * `/sync/status`), which are machine callers, not human admins.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
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

    const nodes = await fetchSyncNodes(tx, tenantId);

    return ok({ nodes });
  });
};
