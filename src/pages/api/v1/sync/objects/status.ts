import type { APIRoute } from "astro";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  bodyTooLargeResponse,
  readTextBody
} from "../../../../../lib/security/request-body-limit";
import {
  resolveOrRegisterSyncNode,
  verifySyncHeaders
} from "../../../../../modules/sync-storage/application/sync-auth";

const LIMIT = 100;

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
      SELECT object_key, status, retry_count, next_retry_at, last_error, byte_size, requires_upload
      FROM awcms_object_sync_queue
      WHERE tenant_id = ${tenantId} AND node_id = ${node.id} AND status <> 'sent'
      ORDER BY created_at ASC
      LIMIT ${LIMIT}
    `;

      type QueueRow = {
        object_key: string;
        status: string;
        retry_count: string | number;
        next_retry_at: Date | null;
        last_error: string | null;
        byte_size: string | number;
        requires_upload: boolean;
      };

      const objects = (rows as QueueRow[]).map((row) => ({
        objectKey: row.object_key,
        status: row.status,
        retryCount: Number(row.retry_count),
        nextRetryAt: row.next_retry_at?.toISOString(),
        lastError: row.last_error ?? undefined,
        byteSize: Number(row.byte_size),
        requiresUpload: row.requires_upload
      }));

      return ok({ objects });
    },
    { workClass: "background_sync" }
  );
};
