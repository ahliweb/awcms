import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { findProjectionDescriptor } from "../../../../../modules/reporting/application/projection-directory";
import {
  createScheduledExport,
  listScheduledExports
} from "../../../../../modules/reporting/application/scheduled-export-store";

const IDEMPOTENCY_SCOPE = "reporting_scheduled_export_create";
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 60 * 24 * 30; // 30 days

/** `GET /api/v1/reports/exports` (Issue #753) — list scheduled export configs for the caller's tenant. */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const projectionKey = url.searchParams.get("projectionKey") ?? undefined;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "exports",
      action: "read"
    });

    if (!auth.allowed) {
      return auth.denied;
    }

    const scheduledExports = await listScheduledExports(
      tx,
      tenantId,
      projectionKey
    );

    return ok({ scheduledExports });
  });
};

type CreateScheduledExportBody = {
  projectionKey?: unknown;
  format?: unknown;
  scheduleIntervalMinutes?: unknown;
  filter?: unknown;
};

/** `POST /api/v1/reports/exports` (Issue #753) — create a scheduled export config. High-risk (`configure`), `Idempotency-Key`-required, audited. */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  let body: CreateScheduledExportBody;
  try {
    body = (await request.json()) as CreateScheduledExportBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const projectionKey =
    typeof body.projectionKey === "string" ? body.projectionKey : "";
  const format =
    body.format === "json" ? "json" : body.format === "csv" ? "csv" : null;
  const scheduleIntervalMinutes =
    typeof body.scheduleIntervalMinutes === "number"
      ? body.scheduleIntervalMinutes
      : NaN;
  const filter =
    body.filter && typeof body.filter === "object"
      ? (body.filter as Record<string, unknown>)
      : {};

  if (!projectionKey) {
    return fail(400, "VALIDATION_ERROR", "projectionKey is required.");
  }
  if (!format) {
    return fail(400, "VALIDATION_ERROR", 'format must be "csv" or "json".');
  }
  if (Object.keys(filter).length > 0) {
    // `filter` is accepted/persisted/documented in OpenAPI (a deliberately
    // generic, unspecified shape a future issue would define), but
    // `generateProjectionExport` does not yet consult it at all — every
    // export always contains the full metric snapshot regardless of what
    // was submitted here. Rejecting a non-empty filter (rather than
    // silently accepting and ignoring it) avoids a false sense of
    // scoping — reviewer + security-auditor finding, PR #781. Remove this
    // guard, and wire `filter` into `generateProjectionExport`, together
    // in the same follow-up issue that defines the filter schema.
    return fail(
      400,
      "NOT_IMPLEMENTED",
      "filter is not yet applied to generated exports — omit it (or pass an empty object) until this is implemented."
    );
  }
  if (
    !Number.isInteger(scheduleIntervalMinutes) ||
    scheduleIntervalMinutes < MIN_INTERVAL_MINUTES ||
    scheduleIntervalMinutes > MAX_INTERVAL_MINUTES
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `scheduleIntervalMinutes must be an integer between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES}.`
    );
  }

  const descriptor = findProjectionDescriptor(projectionKey);
  if (!descriptor || descriptor.scope !== "tenant") {
    return fail(
      404,
      "NOT_FOUND",
      `No registered projection with key "${projectionKey}".`
    );
  }

  const requestHash = computeRequestHash(body);
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

    const scheduledExport = await createScheduledExport(tx, tenantId, {
      projectionKey,
      format,
      scheduleIntervalMinutes,
      filter,
      createdBy: auth.context.tenantUserId
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "reporting",
      action: "reporting.export.schedule_created",
      resourceType: "reporting_scheduled_export",
      resourceId: scheduledExport.id,
      severity: "info",
      message: `Scheduled export created for "${projectionKey}" (every ${scheduleIntervalMinutes} minute(s), ${format}).`,
      attributes: { projectionKey, format, scheduleIntervalMinutes },
      correlationId
    });

    const successResponse = ok({ scheduledExport });
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
