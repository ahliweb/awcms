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

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const POST: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  const nodeCode = request.headers.get("x-awcms-node-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!nodeCode) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "X-AWCMS-Node-ID header is required."
    );
  }

  const bodyRead = await readTextBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const rawBody = bodyRead.value;
  const authResult = verifySyncHeaders(
    request.headers.get("x-awcms-timestamp"),
    request.headers.get("x-awcms-signature"),
    rawBody
  );

  if (!authResult.ok) {
    return fail(authResult.status, authResult.code, authResult.message);
  }

  let parsedBody: { limit?: unknown } = {};

  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Sync pull body must be valid JSON."
      );
    }
  }

  const requestedLimit = Number(parsedBody?.limit);
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const sql = getDatabaseClient();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const node = await resolveOrRegisterSyncNode(tx, tenantId, nodeCode);

      if (!node || node.status !== "active") {
        return fail(403, "ACCESS_DENIED", "Sync node is not active.");
      }

      const checkpointRows = await tx`
      SELECT last_pull_sequence FROM awcms_sync_nodes WHERE id = ${node.id}
    `;
      const sinceSequence = Number(checkpointRows[0]!.last_pull_sequence);

      const rows = await tx`
      SELECT sequence, event_type, aggregate_type, aggregate_id, payload_json, created_at
      FROM awcms_sync_outbox
      WHERE tenant_id = ${tenantId} AND sequence > ${sinceSequence}
      ORDER BY sequence ASC
      LIMIT ${limit}
    `;

      type OutboxRow = {
        sequence: string | number;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string | null;
        payload_json: unknown;
        created_at: Date;
      };

      const events = (rows as OutboxRow[]).map((row) => ({
        sequence: Number(row.sequence),
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id ?? undefined,
        payload: row.payload_json,
        createdAt: row.created_at.toISOString()
      }));

      const newCheckpoint =
        events.length > 0 ? events[events.length - 1]!.sequence : sinceSequence;

      await tx`
      UPDATE awcms_sync_nodes
      SET last_pulled_at = now(), last_pull_sequence = ${newCheckpoint}
      WHERE id = ${node.id}
    `;

      return ok({
        events,
        checkpoint: newCheckpoint,
        hasMore: events.length === limit
      });
    },
    { workClass: "background_sync" }
  );
};
