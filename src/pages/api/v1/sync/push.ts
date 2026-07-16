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
import { evaluatePushEventConflict } from "../../../../modules/sync-storage/domain/sync-conflict";
import { validateSyncPushRequestBody } from "../../../../modules/sync-storage/domain/sync-validation";

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

  const bodyRead = await readTextBody(request, "large");

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

  let parsedBody: unknown = null;

  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Sync push body must be valid JSON."
      );
    }
  }

  const validation = validateSyncPushRequestBody(parsedBody);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Sync push body is invalid.",
      {},
      validation.errors
    );
  }

  const { batchId, events } = validation.value;
  const sql = getDatabaseClient();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const node = await resolveOrRegisterSyncNode(tx, tenantId, nodeCode);

      if (!node || node.status !== "active") {
        return fail(403, "ACCESS_DENIED", "Sync node is not active.");
      }

      const existingBatch = await tx`
      SELECT event_count, conflicted_count FROM awcms_sync_push_batches
      WHERE tenant_id = ${tenantId} AND node_id = ${node.id} AND batch_id = ${batchId}
    `;

      if (existingBatch[0]) {
        const total = existingBatch[0].event_count as number;
        const conflicted = existingBatch[0].conflicted_count as number;

        return ok({
          batchId,
          accepted: total - conflicted,
          conflicted,
          duplicate: true
        });
      }

      let acceptedCount = 0;
      let conflictedCount = 0;

      // Prefetch every aggregate's current_version in one round trip instead
      // of one `SELECT ... WHERE aggregate_id = X` per event — Issue #435
      // N+1 audit (skill `awcms-performance` §Hindari N+1). Keyed by
      // `aggregateType:aggregateId` (not aggregate_id alone) since the
      // uniqueness guarantee on `awcms_sync_aggregate_versions` is the
      // composite `(tenant_id, aggregate_type, aggregate_id)` — two
      // different aggregate types could coincidentally share an id. The map
      // is updated in-memory after each accepted event so a batch that
      // references the same aggregate more than once still sees the correct
      // incrementally-bumped version for its later events, matching the
      // previous read-per-event behavior exactly; only the per-event write
      // to `awcms_sync_inbox`/`awcms_sync_conflicts`/
      // `awcms_sync_aggregate_versions` still happens per event (those
      // are conditional on this event's own conflict outcome, not a
      // batchable read).
      const aggregateIds = [
        ...new Set(
          events
            .filter(
              (event): event is typeof event & { aggregateId: string } =>
                event.aggregateId !== undefined
            )
            .map((event) => event.aggregateId)
        )
      ];

      const versionMap = new Map<string, number>();

      if (aggregateIds.length > 0) {
        const versionRows = (await tx`
          SELECT aggregate_type, aggregate_id, current_version
          FROM awcms_sync_aggregate_versions
          WHERE tenant_id = ${tenantId}
            AND aggregate_id = ANY(${tx.array(aggregateIds, "uuid")})
        `) as {
          aggregate_type: string;
          aggregate_id: string;
          current_version: string | number;
        }[];

        for (const row of versionRows) {
          versionMap.set(
            `${row.aggregate_type}:${row.aggregate_id}`,
            Number(row.current_version)
          );
        }
      }

      for (const event of events) {
        if (event.aggregateId === undefined) {
          await tx`
          INSERT INTO awcms_sync_inbox
            (tenant_id, node_id, batch_id, event_type, aggregate_type, aggregate_id, payload_json)
          VALUES (
            ${tenantId}, ${node.id}, ${batchId}, ${event.eventType}, ${event.aggregateType},
            null, ${event.payload}
          )
        `;
          acceptedCount += 1;
          continue;
        }

        const versionKey = `${event.aggregateType}:${event.aggregateId}`;
        const currentVersion = versionMap.get(versionKey) ?? 0;
        const evaluation = evaluatePushEventConflict(
          currentVersion,
          event.baseVersion
        );

        if (evaluation.conflict) {
          await tx`
          INSERT INTO awcms_sync_conflicts
            (tenant_id, node_id, batch_id, aggregate_type, aggregate_id, conflict_type, payload_json)
          VALUES (
            ${tenantId}, ${node.id}, ${batchId}, ${event.aggregateType}, ${event.aggregateId},
            ${evaluation.conflictType}, ${event.payload}
          )
        `;
          conflictedCount += 1;
          continue;
        }

        await tx`
        INSERT INTO awcms_sync_inbox
          (tenant_id, node_id, batch_id, event_type, aggregate_type, aggregate_id, payload_json)
        VALUES (
          ${tenantId}, ${node.id}, ${batchId}, ${event.eventType}, ${event.aggregateType},
          ${event.aggregateId}, ${event.payload}
        )
      `;

        await tx`
        INSERT INTO awcms_sync_aggregate_versions (tenant_id, aggregate_type, aggregate_id, current_version)
        VALUES (${tenantId}, ${event.aggregateType}, ${event.aggregateId}, ${currentVersion + 1})
        ON CONFLICT (tenant_id, aggregate_type, aggregate_id)
        DO UPDATE SET current_version = ${currentVersion + 1}, updated_at = now()
      `;
        // Keep the in-memory prefetch map in sync so a later event in this
        // same batch for the same aggregate sees the version this event
        // just bumped to (matching the old read-per-event behavior).
        versionMap.set(versionKey, currentVersion + 1);
        acceptedCount += 1;
      }

      await tx`
      INSERT INTO awcms_sync_push_batches (tenant_id, node_id, batch_id, event_count, conflicted_count)
      VALUES (${tenantId}, ${node.id}, ${batchId}, ${events.length}, ${conflictedCount})
    `;

      await tx`
      UPDATE awcms_sync_nodes SET last_pushed_at = now() WHERE id = ${node.id}
    `;

      return ok({
        batchId,
        accepted: acceptedCount,
        conflicted: conflictedCount,
        duplicate: false
      });
    },
    { workClass: "background_sync" }
  );
};
