import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { validateUpdateSyncNodeInput } from "../../../../../modules/sync-storage/domain/node-management";

const UPDATE_GUARD = {
  moduleKey: "sync_storage",
  activityCode: "node_management",
  action: "update" as const
};

/**
 * Deactivating a node here takes effect immediately: every HMAC sync
 * endpoint (`/sync/push`, `/sync/pull`, `/sync/status`, `/sync/objects*`)
 * already rejects `node.status !== "active"` with 403 — this is the
 * (previously missing) admin control for that gate, e.g. to revoke a
 * lost/retired device.
 */
export const PATCH: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const nodeId = params.id;

  if (!nodeId) {
    return fail(400, "VALIDATION_ERROR", "Node id is required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateSyncNodeInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Sync node update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const nodeRows = await tx`
      SELECT id FROM awcms_sync_nodes
      WHERE tenant_id = ${tenantId} AND id = ${nodeId}
    `;

    if (!nodeRows[0]) {
      return fail(404, "RESOURCE_NOT_FOUND", "Sync node not found.");
    }

    if (input.status !== undefined) {
      await tx`
        UPDATE awcms_sync_nodes
        SET status = ${input.status}, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${nodeId}
      `;
    }

    if (input.nodeName !== undefined) {
      await tx`
        UPDATE awcms_sync_nodes
        SET node_name = ${input.nodeName}, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${nodeId}
      `;
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "sync_storage",
      action: "update",
      resourceType: "sync_node",
      resourceId: nodeId,
      severity: "warning",
      message: "Sync node updated.",
      attributes: { status: input.status, nodeName: input.nodeName }
    });

    return ok({ nodeId, status: input.status, nodeName: input.nodeName });
  });
};
