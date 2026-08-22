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
import {
  buildSubjectPlan,
  erasureTargets
} from "../../../../../modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../../../../modules/data-lifecycle/domain/subject-data-registry";
import {
  createErasureRequest,
  resolveSubject
} from "../../../../../modules/data-lifecycle/application/subject-request-service";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";

/**
 * `POST /api/v1/data-lifecycle/subject-requests/erase` — ADR-0094, Issue #557.
 *
 * The MAKER half. It records a request and erases nothing.
 *
 * ## Why this route cannot erase, even for somebody holding both keys
 *
 * ADR-0094 Decision 3 makes erasure maker/checker, and this is where that is
 * structural rather than procedural: there is no branch here that writes to
 * another module's table. Execution lives behind
 * `POST /subject-requests/{id}/decide`, guarded by a DIFFERENT permission, and
 * the row's own CHECK constraint refuses a decision by its own requester. A
 * caller who somehow holds both keys still cannot approve their own request —
 * the database will not store it.
 *
 * The `data_lifecycle.subject_erasure_maker_checker` SoD rule makes holding
 * both a `critical` conflict in the first place, so the constraint is the
 * second line rather than the only one.
 *
 * ## The response previews what would be written
 *
 * A checker approving blind is not a checker. The reply names the tables the
 * erasure would actually WRITE — `erasureTargets`, which is far fewer than the
 * tables the subject appears in, because most are severed by anonymising the
 * identity row and need no write of their own.
 */
const IDEMPOTENCY_SCOPE = "data_lifecycle_subject_erasure_request";

type Prepared = {
  idempotencyKey: string;
  subjectTenantUserId: string;
  reason: string;
  requestHash: string;
};

export const POST = defineTenantRoute<Prepared>({
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
    // Mandatory, and mandatory at a length that cannot be satisfied by "ok".
    // The checker's only input for an irreversible decision is this sentence.
    if (reason.length < 8) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required and must state the ground for erasure."
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
    activityCode: "subject_erasure",
    action: "create"
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
    const record = await createErasureRequest(tx, tenantId, {
      subjectTenantUserId: prepared.subjectTenantUserId,
      reason: prepared.reason,
      requestedBy: auth.context.tenantUserId,
      correlationId: locals.correlationId ?? null
    });

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "data_lifecycle",
      action: "subject_erasure.requested",
      resourceType: "subject_request",
      resourceId: record.id,
      severity: "critical",
      message: `Erasure requested for tenant user ${prepared.subjectTenantUserId}`,
      attributes: {
        subjectTenantUserId: prepared.subjectTenantUserId,
        reason: prepared.reason
      },
      correlationId: locals.correlationId ?? undefined
    });

    const successResponse = ok({
      request: record,
      // What approving it would actually write, so the checker is not deciding
      // blind — see this file's header.
      wouldWrite: erasureTargets(plan).map((entry) => ({
        key: entry.key,
        tableName: entry.tableName,
        erasure: entry.erasure
      })),
      retained: plan.retainedEntries.map((entry) => ({
        key: entry.key,
        tableName: entry.tableName,
        ownerModuleKey: entry.ownerModuleKey,
        rationale: entry.rationale
      })),
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
