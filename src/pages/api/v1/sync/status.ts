import type { APIRoute } from "astro";
import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  bodyTooLargeResponse,
  readTextBody
} from "../../../../lib/security/request-body-limit";
import {
  resolveOrRegisterSyncNode,
  verifySyncHeaders
} from "../../../../modules/sync-storage/application/sync-auth";

export const GET: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  const nodeCode = request.headers.get("x-awcms-node-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!nodeCode) {
    return fail(400, "VALIDATION_ERROR", "X-AWCMS-Node-ID header is required.");
  }

  const bodyRead = await readTextBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const rawBody = bodyRead.value;
  const authResult = verifySyncHeaders(
    tenantId,
    nodeCode,
    request.headers.get("x-awcms-timestamp"),
    request.headers.get("x-awcms-signature"),
    request.headers.get("x-awcms-signature-version"),
    rawBody
  );

  if (!authResult.ok) {
    return fail(authResult.status, authResult.code, authResult.message);
  }

  const sql = getDatabaseClient();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const node = await resolveOrRegisterSyncNode(tx, tenantId, nodeCode);

      if (!node || node.status !== "active") {
        return fail(403, "ACCESS_DENIED", "Sync node is not active.");
      }

      const rows = await tx`
      SELECT node_code, status, last_pushed_at, last_pulled_at, last_pull_sequence
      FROM awcms_sync_nodes
      WHERE id = ${node.id}
    `;
      const row = rows[0] as {
        node_code: string;
        status: string;
        last_pushed_at: Date | null;
        last_pulled_at: Date | null;
        last_pull_sequence: string | number;
      };

      return ok({
        nodeCode: row.node_code,
        status: row.status,
        lastPushedAt: row.last_pushed_at?.toISOString(),
        lastPulledAt: row.last_pulled_at?.toISOString(),
        checkpoint: Number(row.last_pull_sequence)
      });
    },
    { workClass: "background_sync" }
  );
};
