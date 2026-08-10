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
import {
  SYNC_REPLICABLE_EVENT_TYPES,
  syncReplicationIsDisabled
} from "../../../../modules/sync-storage/domain/sync-replication";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export const POST: APIRoute = async ({ request }) => {
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

      type OutboxRow = {
        event_sequence: string | number;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string | null;
        payload: unknown;
        recorded_at: Date;
      };

      // ADR-0077. The source is `awcms_domain_events` — this repo's one
      // transactional outbox — and no query runs while nothing is declared
      // replicable. That is not an optimisation: an unconditional cursor scan
      // here would read as "replication works", and it does not yet. See
      // `domain/sync-replication.ts` for the two things that block an entry.
      const rows = syncReplicationIsDisabled()
        ? []
        : await tx`
      SELECT event_sequence, event_type, aggregate_type, aggregate_id, payload, recorded_at
      FROM awcms_domain_events
      WHERE tenant_id = ${tenantId}
        AND event_sequence > ${sinceSequence}
        AND event_type = ANY(${tx.array(SYNC_REPLICABLE_EVENT_TYPES as string[], "text")})
      ORDER BY event_sequence ASC
      LIMIT ${limit}
    `;

      const events = (rows as OutboxRow[]).map((row) => ({
        sequence: Number(row.event_sequence),
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id ?? undefined,
        payload: row.payload,
        createdAt: row.recorded_at.toISOString()
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
