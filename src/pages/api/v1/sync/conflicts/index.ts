import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  fetchSyncConflicts,
  type SyncConflictStatus
} from "../../../../../modules/sync-storage/application/sync-directory";

const GUARD_REQUEST = {
  moduleKey: "sync_storage",
  activityCode: "conflict_resolution",
  action: "read" as const
};

export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const statusFilter = url.searchParams.get("status");
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
        GUARD_REQUEST
      );

      if (!auth.allowed) {
        return auth.denied;
      }

      const conflicts = await fetchSyncConflicts(
        tx,
        tenantId,
        statusFilter === "open" || statusFilter === "resolved"
          ? (statusFilter as SyncConflictStatus)
          : undefined
      );

      return ok({
        // `fetchSyncConflicts` returns `null` for an unresolved conflict's
        // resolution fields, which is the shape a page wants. This endpoint
        // has always OMITTED them instead (`JSON.stringify` drops
        // `undefined`), so they are mapped back — a `null` where a client
        // expects an absent key is a wire-format change, not a refactor.
        conflicts: conflicts.map((conflict) => ({
          ...conflict,
          resolution: conflict.resolution ?? undefined,
          resolutionNote: conflict.resolutionNote ?? undefined,
          resolvedBy: conflict.resolvedBy ?? undefined,
          resolvedAt: conflict.resolvedAt ?? undefined
        }))
      });
    },
    { workClass: "background_sync" }
  );
};
