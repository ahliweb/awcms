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
import { triggerOrResumeRebuild } from "../../../../../../../modules/reporting/application/projection-rebuild";

const IDEMPOTENCY_SCOPE = "reporting_projection_rebuild";

type RebuildRequestBody = { reason?: unknown };

/**
 * `POST /api/v1/reports/projections/{key}/rebuild` (Issue #753) — trigger
 * a full rebuild, or return the already-`'running'` rebuild if one exists
 * (idempotent-by-design at the domain layer via migration 069's partial
 * unique index — see `application/projection-rebuild.ts`'s header comment
 * — ADDITIONALLY guarded here by the ordinary `Idempotency-Key` HTTP
 * mutation contract every high-risk endpoint in this repo uses). High-risk
 * (`AccessAction.rebuild`), reason-required (matches the `replay`/legal-
 * hold precedent), audited `warning`.
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

  let body: RebuildRequestBody;
  try {
    body = (await request.json()) as RebuildRequestBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) {
    return fail(400, "VALIDATION_ERROR", "reason must be 1-500 characters.");
  }

  const descriptor = findProjectionDescriptor(key);
  if (!descriptor || descriptor.scope !== "tenant") {
    return fail(
      404,
      "NOT_FOUND",
      `No registered projection with key "${key}".`
    );
  }

  const requestHash = computeRequestHash({ ...body, key, action: "rebuild" });
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

    const { run, resumed } = await triggerOrResumeRebuild(
      tx,
      tenantId,
      descriptor,
      {
        requestedBy: auth.context.tenantUserId,
        reason,
        correlationId
      }
    );

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "reporting",
      action: "reporting.projection.rebuild_triggered",
      resourceType: "reporting_projection",
      resourceId: descriptor.key,
      severity: "warning",
      message: resumed
        ? `Rebuild of "${descriptor.key}" was already running — returned the existing run instead of resetting progress.`
        : `Rebuild of "${descriptor.key}" triggered.`,
      attributes: { runId: run.id, resumed, reason },
      correlationId
    });

    const successResponse = ok({ rebuild: run, resumed });
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
