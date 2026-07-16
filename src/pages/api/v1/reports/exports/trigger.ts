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
import { generateProjectionExport } from "../../../../../modules/reporting/application/export-generation";

const IDEMPOTENCY_SCOPE = "reporting_export_trigger";

type TriggerExportBody = { projectionKey?: unknown; format?: unknown };

/**
 * `POST /api/v1/reports/exports/trigger` (Issue #753) — manually generate
 * an export of a projection's current snapshot. High-risk (`export`),
 * `Idempotency-Key`-required, audited.
 *
 * The actual file write (`generateProjectionExport`) runs OUTSIDE any DB
 * transaction, between two short `withTenant` calls (auth+idempotency
 * pre-check, then audit+idempotency-save) — same "provider-shaped I/O
 * never runs inside a DB transaction" posture AGENTS.md rule 11 requires
 * for external providers, applied here to a local filesystem write too.
 * KNOWN LIMITATION: because the pre-check and the save are in separate
 * transactions, two requests racing on the SAME Idempotency-Key can both
 * pass the pre-check and both execute the write before the second one's
 * save loses the race and replays the first's response — a bounded,
 * low-probability duplicate-file/duplicate-export_runs-row outcome (never
 * a security or tenant-isolation issue), the same structural tradeoff
 * every provider-call endpoint in this repo already accepts (e.g. email
 * send idempotency is enforced at ENQUEUE time, not at the actual SMTP
 * call).
 */
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

  let body: TriggerExportBody;
  try {
    body = (await request.json()) as TriggerExportBody;
  } catch {
    return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }

  const projectionKey =
    typeof body.projectionKey === "string" ? body.projectionKey : "";
  const format =
    body.format === "json" ? "json" : body.format === "csv" ? "csv" : null;

  if (!projectionKey) {
    return fail(400, "VALIDATION_ERROR", "projectionKey is required.");
  }
  if (!format) {
    return fail(400, "VALIDATION_ERROR", 'format must be "csv" or "json".');
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

  const preCheck = await withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(tx, tenantId, tokenHash, now, {
      moduleKey: "reporting",
      activityCode: "exports",
      action: "export"
    });

    if (!auth.allowed) {
      return { ok: false as const, response: auth.denied };
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existingIdempotency) {
      if (existingIdempotency.requestHash !== requestHash) {
        return {
          ok: false as const,
          response: fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different request."
          )
        };
      }
      return {
        ok: false as const,
        response: jsonResponse(existingIdempotency.responseBody, {
          status: existingIdempotency.responseStatus
        })
      };
    }

    return { ok: true as const, actorTenantUserId: auth.context.tenantUserId };
  });

  if (!preCheck.ok) {
    return preCheck.response;
  }

  const exportRun = await generateProjectionExport(sql, {
    tenantId,
    descriptor,
    format,
    scheduledExportId: null,
    requestedBy: preCheck.actorTenantUserId,
    correlationId
  });

  return withTenant(sql, tenantId, async (tx) => {
    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: preCheck.actorTenantUserId,
      moduleKey: "reporting",
      action: "reporting.export.triggered",
      resourceType: "reporting_export_run",
      resourceId: exportRun.id,
      severity: exportRun.status === "failed" ? "warning" : "info",
      message: `Manual export of "${descriptor.key}" (${format}) — ${exportRun.status}.`,
      attributes: {
        projectionKey: descriptor.key,
        format,
        status: exportRun.status,
        rowCount: exportRun.rowCount
      },
      correlationId
    });

    const successResponse = ok({ export: exportRun });
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
