import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../../lib/database/client";
import { withTenant } from "../../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";
import { findProjectionDescriptor } from "../../../../../../../modules/reporting/application/projection-directory";
import {
  requestRebuildCancellation,
  findRunningRebuild
} from "../../../../../../../modules/reporting/application/rebuild-run-store";

const IDEMPOTENCY_SCOPE = "reporting_projection_rebuild_cancel";

/**
 * `POST /api/v1/reports/projections/{key}/rebuild/cancel` (Issue #753) —
 * requests cooperative cancellation of the currently-`'running'` rebuild
 * for this projection (a no-op, `404`, if none is running). Checked by
 * `application/projection-rebuild.ts`'s bounded-pass loop between passes
 * (same cooperative-cancellation model `runBoundedBatches`'s own `signal`
 * already uses) — the CURRENT in-flight pass always finishes, only the
 * NEXT one is skipped.
 */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const key = params.key;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }
  if (!key) {
    return fail(400, "VALIDATION_ERROR", "Projection key is required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const descriptor = findProjectionDescriptor(key);
  if (!descriptor || descriptor.scope !== "tenant") {
    return fail(
      404,
      "NOT_FOUND",
      `No registered projection with key "${key}".`
    );
  }

  const requestHash = computeRequestHash({ key, action: "rebuild_cancel" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "projections",
      action: "rebuild"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existingIdempotency.responseBody, {
        status: existingIdempotency.responseStatus
      });
    }

    const running = await findRunningRebuild(tx, tenantId, descriptor.key);
    if (!running) {
      return fail(
        404,
        "NOT_FOUND",
        `No running rebuild for projection "${descriptor.key}".`
      );
    }

    await requestRebuildCancellation(tx, tenantId, running.id);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "reporting",
      action: "reporting.projection.rebuild_cancel_requested",
      resourceType: "reporting_projection",
      resourceId: descriptor.key,
      severity: "warning",
      message: `Cancellation requested for rebuild "${running.id}" of "${descriptor.key}".`,
      attributes: { runId: running.id },
      correlationId
    });

    const successResponse = ok({
      rebuildId: running.id,
      cancelRequested: true
    });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
