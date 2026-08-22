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
  evaluatePushEventConflict,
  type SyncConflictType
} from "../../../../modules/sync-storage/domain/sync-conflict";
import { advanceAggregateVersion } from "../../../../modules/sync-storage/application/aggregate-version-store";
import { validateSyncPushRequestBody } from "../../../../modules/sync-storage/domain/sync-validation";

export const POST: APIRoute = async ({ request }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  const nodeCode = request.headers.get("x-awcms-node-id");

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!nodeCode) {
    return fail(400, "VALIDATION_ERROR", "X-AWCMS-Node-ID header is required.");
  }

  const bodyRead = await readTextBody(request, "large");

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

        const recordConflict = async (conflictType: SyncConflictType) => {
          await tx`
            INSERT INTO awcms_sync_conflicts
              (tenant_id, node_id, batch_id, aggregate_type, aggregate_id, conflict_type, payload_json)
            VALUES (
              ${tenantId}, ${node.id}, ${batchId}, ${event.aggregateType}, ${event.aggregateId},
              ${conflictType}, ${event.payload}
            )
          `;
          conflictedCount += 1;
        };

        if (evaluation.conflict) {
          await recordConflict(evaluation.conflictType);
          continue;
        }

        // Finding C3 — this used to write the version unconditionally:
        //
        //   DO UPDATE SET current_version = ${currentVersion + 1}
        //
        // Two concurrent batches for the same aggregate both read 5, both
        // passed the check above with `baseVersion = 5`, and both wrote the
        // literal 6. Two conflicting events accepted, ZERO conflict rows, one
        // increment lost — the read and the write were not atomic with respect
        // to each other, and `evaluatePushEventConflict` was deciding on a
        // value that could already be stale by the time it was acted on.
        //
        // `WHERE ... current_version = ${currentVersion}` makes it a
        // compare-and-set: the row is only advanced if it still holds the value
        // this decision was made on. A CAS that matches nothing means another
        // writer moved it in between, which is exactly `version_mismatch` — the
        // same verdict the pure evaluator would have reached with a fresh read,
        // so the outcome is one the node already understands.
        //
        // On the INSERT path (`currentVersion = 0`, no row yet) the same
        // predicate covers the create race: the loser's `ON CONFLICT DO UPDATE`
        // finds `current_version = 1` and refuses.
        //
        // FOR UPDATE on the prefetch was the alternative and is weaker: it locks
        // only rows that EXIST, so two batches creating the same aggregate would
        // still both proceed, and it would serialise the whole batch's
        // aggregates for the duration of the transaction rather than one row for
        // the duration of one statement.
        const advanced = await advanceAggregateVersion(
          tx,
          tenantId,
          event.aggregateType,
          event.aggregateId,
          currentVersion
        );

        if (!advanced) {
          await recordConflict("version_mismatch");
          continue;
        }

        // The inbox row is written only AFTER the version has actually been
        // advanced. It used to be written first, so a losing batch left an
        // accepted event behind for an increment it never made.
        await tx`
          INSERT INTO awcms_sync_inbox
            (tenant_id, node_id, batch_id, event_type, aggregate_type, aggregate_id, payload_json)
          VALUES (
            ${tenantId}, ${node.id}, ${batchId}, ${event.eventType}, ${event.aggregateType},
            ${event.aggregateId}, ${event.payload}
          )
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
