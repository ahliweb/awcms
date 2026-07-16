import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { disableScheduledExport } from "../../../../../../modules/reporting/application/scheduled-export-store";

const IDEMPOTENCY_SCOPE = "reporting_scheduled_export_disable";

type DisableBody = { reason?: unknown };

/** `POST /api/v1/reports/exports/{id}/disable` (Issue #753) — disable (soft-delete) a scheduled export config. High-risk (`configure`), reason-required, `Idempotency-Key`-required, audited. */
export const POST: APIRoute = async ({ request, cookies, locals, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }
  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Scheduled export id is required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  let body: DisableBody;
  try {
    body = (await request.json()) as DisableBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 1 || reason.length > 500) {
    return fail(400, "VALIDATION_ERROR", "reason must be 1-500 characters.");
  }

  const requestHash = computeRequestHash({ ...body, id, action: "disable" });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "exports",
      action: "configure"
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

    const disabled = await disableScheduledExport(
      tx,
      tenantId,
      id,
      auth.context.tenantUserId,
      reason
    );

    if (!disabled) {
      return fail(
        404,
        "NOT_FOUND",
        "Scheduled export not found (or already disabled)."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "reporting",
      action: "reporting.export.schedule_disabled",
      resourceType: "reporting_scheduled_export",
      resourceId: id,
      severity: "info",
      message: `Scheduled export "${id}" disabled.`,
      attributes: { reason },
      correlationId
    });

    const successResponse = ok({ id, disabled: true });
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
