import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";

const GUARD_REQUEST = {
  moduleKey: "sync_storage",
  activityCode: "conflict_resolution",
  action: "read" as const
};

const MAX_RESULTS = 50;

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

      const rows =
        statusFilter === "open" || statusFilter === "resolved"
          ? await tx`
            SELECT id, node_id, batch_id, aggregate_type, aggregate_id, conflict_type,
                   payload_json, status, resolution, resolution_note, resolved_by, resolved_at, created_at
            FROM awcms_sync_conflicts
            WHERE tenant_id = ${tenantId} AND status = ${statusFilter}
            ORDER BY created_at DESC
            LIMIT ${MAX_RESULTS}
          `
          : await tx`
            SELECT id, node_id, batch_id, aggregate_type, aggregate_id, conflict_type,
                   payload_json, status, resolution, resolution_note, resolved_by, resolved_at, created_at
            FROM awcms_sync_conflicts
            WHERE tenant_id = ${tenantId}
            ORDER BY created_at DESC
            LIMIT ${MAX_RESULTS}
          `;

      type ConflictRow = {
        id: string;
        node_id: string;
        batch_id: string;
        aggregate_type: string;
        aggregate_id: string;
        conflict_type: string;
        payload_json: unknown;
        status: string;
        resolution: string | null;
        resolution_note: string | null;
        resolved_by: string | null;
        resolved_at: Date | null;
        created_at: Date;
      };

      return ok({
        conflicts: (rows as ConflictRow[]).map((row) => ({
          id: row.id,
          nodeId: row.node_id,
          batchId: row.batch_id,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          conflictType: row.conflict_type,
          payload: row.payload_json,
          status: row.status,
          resolution: row.resolution ?? undefined,
          resolutionNote: row.resolution_note ?? undefined,
          resolvedBy: row.resolved_by ?? undefined,
          resolvedAt: row.resolved_at?.toISOString(),
          createdAt: row.created_at.toISOString()
        }))
      });
    },
    { workClass: "background_sync" }
  );
};
