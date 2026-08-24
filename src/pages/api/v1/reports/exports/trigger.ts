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
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

const IDEMPOTENCY_SCOPE = "reporting_export_trigger";

type TriggerExportBody = { projectionKey?: unknown; format?: unknown };

type HeldTrigger =
  | { kind: "refusal"; response: Response }
  | {
      kind: "input";
      idempotencyKey: string;
      format: "csv" | "json";
      descriptor: NonNullable<ReturnType<typeof findProjectionDescriptor>>;
    };

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

  const bodyRead = await readJsonBody<TriggerExportBody>(request);

  // The body-size ceiling is a PROTOCOL limit, not a product answer, so it
  // stays ahead of everything — refusing it tells the caller nothing they did
  // not already send.
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const body = (bodyRead.value ?? {}) as TriggerExportBody;

  const projectionKey =
    typeof body.projectionKey === "string" ? body.projectionKey : "";
  const format =
    body.format === "json" ? "json" : body.format === "csv" ? "csv" : null;
  const descriptor = projectionKey
    ? findProjectionDescriptor(projectionKey)
    : undefined;

  /**
   * Every product answer this route can give is decided out here and HELD until
   * `authorizeInTransaction` has spoken. The work still happens before the
   * transaction opens — reading a body waits on the CLIENT, and doing that
   * inside `withTenant` would hold a reserved connection and its work-class
   * slot for as long as a caller chooses to take — but the ANSWER waits.
   *
   * They used to return straight from here, so a tenant user with no
   * `reporting.exports.export` grant learned this route's field names, its
   * accepted formats, and WHICH PROJECTION KEYS THIS DEPLOYMENT HAS REGISTERED
   * (the `404` names the key back). None of it reached
   * `authorizeInTransaction`, which ADR-0063 makes the one place a decision is
   * recorded — so the probing left no `awcms_access_decision_log` row at all.
   * Gap C19.
   */
  const held: HeldTrigger = ((): HeldTrigger => {
    if (!idempotencyKey) {
      return {
        kind: "refusal",
        response: fail(
          400,
          "IDEMPOTENCY_REQUIRED",
          "Idempotency-Key header is required."
        )
      };
    }

    if (bodyRead.malformed) {
      return {
        kind: "refusal",
        response: fail(
          400,
          "VALIDATION_ERROR",
          "Request body must be valid JSON."
        )
      };
    }

    if (!projectionKey) {
      return {
        kind: "refusal",
        response: fail(400, "VALIDATION_ERROR", "projectionKey is required.")
      };
    }

    if (!format) {
      return {
        kind: "refusal",
        response: fail(
          400,
          "VALIDATION_ERROR",
          'format must be "csv" or "json".'
        )
      };
    }

    if (!descriptor || descriptor.scope !== "tenant") {
      return {
        kind: "refusal",
        response: fail(
          404,
          "NOT_FOUND",
          `No registered projection with key "${projectionKey}".`
        )
      };
    }

    return { kind: "input", idempotencyKey, format, descriptor };
  })();

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

    // Allowed — so the caller is entitled to hear what is actually wrong, and
    // the decision log now carries the row saying they were here.
    if (held.kind === "refusal") {
      return { ok: false as const, response: held.response };
    }

    const existingIdempotency = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      held.idempotencyKey
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

    // The validated input travels back out rather than being re-derived: it was
    // proven good before the transaction opened, and only this branch has the
    // narrowing that says so.
    return {
      ok: true as const,
      actorTenantUserId: auth.context.tenantUserId,
      input: held
    };
  });

  // Pool-gate refusal — forwarded as-is (see the note on `withTenant`).
  if (preCheck instanceof Response) {
    return preCheck;
  }

  if (!preCheck.ok) {
    return preCheck.response;
  }

  const exportRun = await generateProjectionExport(sql, {
    tenantId,
    descriptor: preCheck.input.descriptor,
    format: preCheck.input.format,
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
      message: `Manual export of "${preCheck.input.descriptor.key}" (${preCheck.input.format}) — ${exportRun.status}.`,
      attributes: {
        projectionKey: preCheck.input.descriptor.key,
        format: preCheck.input.format,
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
      preCheck.input.idempotencyKey,
      requestHash,
      200,
      successBody
    );

    return successResponse;
  });
};
