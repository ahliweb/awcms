import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const RETRY_GUARD = {
  moduleKey: "sync_storage",
  activityCode: "object_queue",
  action: "retry" as const
};

/**
 * Manual admin retry for a `failed` object sync queue entry. This is a human
 * override of the automatic exponential-backoff schedule
 * (`domain/object-queue.ts`'s `evaluateObjectRetry`, still used by the node's
 * own retry loop) — for when an admin has fixed the underlying issue (e.g.
 * rotated storage credentials) and wants the node to try again immediately,
 * including past OBJECT_SYNC_MAX_RETRIES. Resets `retry_count` to 0,
 * `next_retry_at`/`last_error` to null, and `status` back to `pending` so the
 * node's next `GET /sync/objects/status` poll picks it up. Only `failed`
 * entries are eligible (`pending` is already scheduled; `sent` already
 * succeeded) — both rejected with 409. Does not itself talk to any object
 * storage (see sync-storage/README.md "Belum tersedia" — only a trusted
 * internal dispatcher, not this endpoint, transitions status to sent/failed
 * after a real upload attempt).
 */
export const POST: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const objectQueueId = params.id;

  if (!objectQueueId) {
    return fail(400, "VALIDATION_ERROR", "Object queue id is required.");
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
      RETRY_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const rows = (await tx`
      SELECT id, object_key, status, last_error
      FROM awcms_object_sync_queue
      WHERE tenant_id = ${tenantId} AND id = ${objectQueueId}
    `) as {
      id: string;
      object_key: string;
      status: string;
      last_error: string | null;
    }[];
    const entry = rows[0];

    if (!entry) {
      return fail(404, "RESOURCE_NOT_FOUND", "Object queue entry not found.");
    }

    if (entry.status !== "failed") {
      return fail(
        409,
        "RESOURCE_CONFLICT",
        `Only failed entries can be retried (current status: ${entry.status}).`
      );
    }

    await tx`
      UPDATE awcms_object_sync_queue
      SET status = 'pending', retry_count = 0, next_retry_at = null, last_error = null
      WHERE tenant_id = ${tenantId} AND id = ${objectQueueId}
    `;

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "sync_storage",
      action: "retry",
      resourceType: "object_sync_queue",
      resourceId: objectQueueId,
      severity: "warning",
      message: "Object sync queue entry manually retried.",
      attributes: {
        objectKey: entry.object_key,
        previousError: entry.last_error
      }
    });

    return ok({ objectQueueId, status: "pending" });
  });
};
