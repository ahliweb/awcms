import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { listModules } from "../../../../../modules";
import { buildSubjectPlan } from "../../../../../modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../../../../modules/data-lifecycle/domain/subject-data-registry";
import {
  loadColumnTypes,
  readSubjectExport
} from "../../../../../modules/data-lifecycle/application/subject-data-executor";
import {
  recordExportDisclosure,
  resolveSubject
} from "../../../../../modules/data-lifecycle/application/subject-request-service";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

/**
 * `POST /api/v1/data-lifecycle/subject-requests/export` — ADR-0094, Issue #557.
 *
 * Everything this tenant holds about one data subject, assembled from the
 * `subjectData` registry rather than from a hand-written table list.
 *
 * ## Audited as a DISCLOSURE, not as a read
 *
 * ADR-0094 Decision 3: "anyone who can export any subject can exfiltrate the
 * whole user base one request at a time". So the audit row says
 * `subject_data.disclosed` at `critical`, and a durable row lands in
 * `awcms_subject_requests` in the same transaction. A read that left no trace
 * would make that sentence unverifiable.
 *
 * ## The response states its own coverage
 *
 * `unanswered` carries every table the plan deliberately does NOT reach —
 * global (ADR-0094 Decision 1) or matchable by no column — each with the reason
 * its owning module wrote. A subject-access report that is incomplete and does
 * not say so is worse than none, because it is signed.
 *
 * High-risk mutation in the audit sense even though it only reads: it requires
 * `Idempotency-Key`, so a retried disclosure replays rather than producing a
 * second `disclosed` row that reads like a second disclosure.
 */
const IDEMPOTENCY_SCOPE = "data_lifecycle_subject_export";

type Prepared = {
  idempotencyKey: string;
  subjectTenantUserId: string;
  reason: string;
  requestHash: string;
};

export const POST = defineTenantRoute<Prepared>({
  // Not `reporting`: this is an operator waiting on a page under a statutory
  // clock, not a scheduled batch, and it reads a bounded set of rows for ONE
  // person.
  workClass: "interactive",
  prepare: async ({ request }) => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody<{
      tenantUserId?: unknown;
      reason?: unknown;
    }>(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const body = (bodyRead.value ?? {}) as {
      tenantUserId?: unknown;
      reason?: unknown;
    };

    const subjectTenantUserId =
      typeof body.tenantUserId === "string" ? body.tenantUserId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!subjectTenantUserId) {
      return fail(400, "VALIDATION_ERROR", "tenantUserId is required.");
    }
    // Required for the same reason erasure requires one: the audit row is the
    // control, and "exported by X" without "because Y" cannot be reviewed.
    if (reason.length < 8) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required and must say why the disclosure is being made."
      );
    }

    return {
      idempotencyKey,
      subjectTenantUserId,
      reason,
      requestHash: computeRequestHash(body)
    };
  },
  authorize: {
    moduleKey: "data_lifecycle",
    activityCode: "subject_request",
    action: "export"
  },
  handler: async ({ tx, auth, prepared, tenantId, locals }) => {
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== prepared.requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const resolution = await resolveSubject(
      tx,
      tenantId,
      prepared.subjectTenantUserId
    );

    if (!resolution.resolved) {
      return fail(
        404,
        "RESOURCE_NOT_FOUND",
        "No such tenant user in this tenant."
      );
    }

    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      resolution.subject
    );
    const columnTypes = await loadColumnTypes(
      tx,
      plan.exportEntries.map((entry) => entry.tableName)
    );
    const tables = await readSubjectExport(tx, tenantId, plan, columnTypes);
    const rowCount = tables.reduce((sum, table) => sum + table.rows.length, 0);

    const record = await recordExportDisclosure(tx, tenantId, {
      subjectTenantUserId: prepared.subjectTenantUserId,
      reason: prepared.reason,
      requestedBy: auth.context.tenantUserId,
      tablesAnswered: plan.entries.length,
      tablesUnanswered: plan.unansweredEntries.length,
      rowsAffected: rowCount,
      correlationId: locals.correlationId ?? null
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "data_lifecycle",
      // Not `subject_data.read`. The verb is what a reviewer scans for, and
      // this row exists so "who disclosed whose data" is answerable.
      action: "subject_data.disclosed",
      resourceType: "subject_request",
      resourceId: record.id,
      severity: "critical",
      message: `Subject-access export disclosed for tenant user ${prepared.subjectTenantUserId}`,
      attributes: {
        subjectTenantUserId: prepared.subjectTenantUserId,
        reason: prepared.reason,
        tablesRead: tables.length,
        rowCount,
        tablesUnanswered: plan.unansweredEntries.length
      },
      correlationId: locals.correlationId ?? undefined
    });

    const successResponse = ok({
      request: record,
      subject: { tenantUserId: prepared.subjectTenantUserId },
      tables,
      // The report's own coverage statement — see this file's header.
      unanswered: plan.unansweredEntries
    });
    const successBody = await successResponse.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      prepared.requestHash,
      200,
      successBody
    );

    return successResponse;
  }
});
