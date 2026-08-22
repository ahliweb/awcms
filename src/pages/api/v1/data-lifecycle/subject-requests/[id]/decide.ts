import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { listModules } from "../../../../../../modules";
import {
  buildSubjectPlan,
  erasureTargets
} from "../../../../../../modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../../../../../../modules/data-lifecycle/domain/subject-data-registry";
import {
  loadColumnTypes,
  runSubjectErasure
} from "../../../../../../modules/data-lifecycle/application/subject-data-executor";
import {
  claimPendingErasure,
  recordErasureOutcome,
  resolveSubject
} from "../../../../../../modules/data-lifecycle/application/subject-request-service";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";

/**
 * `POST /api/v1/data-lifecycle/subject-requests/{id}/decide` — ADR-0094, Issue
 * #557.
 *
 * The CHECKER half: approve (and thereby execute) or reject a pending erasure.
 *
 * ## The claim and the erasure are ONE transaction
 *
 * `claimPendingErasure` flips `pending_approval` to `completed` in a single
 * conditional UPDATE, and the erasure runs afterwards inside the same
 * transaction. Two simultaneous approvals therefore cannot both execute: the
 * second UPDATE matches no row, so it never reaches the writes. Splitting the
 * claim from the work — read the status, then erase, then update — is the shape
 * that let a login lockout count K parallel attempts as one increment, and here
 * it would run an irreversible erasure twice.
 *
 * ## Rejecting is a first-class outcome
 *
 * A checker who can only approve is a rubber stamp. `decision: "reject"` closes
 * the request with its own reason and writes nothing, and both outcomes are
 * audited `critical` — a refusal to erase is as much a data-protection decision
 * as an erasure.
 */
const IDEMPOTENCY_SCOPE = "data_lifecycle_subject_erasure_decide";

type Prepared = {
  idempotencyKey: string;
  decision: "approve" | "reject";
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
      decision?: unknown;
      reason?: unknown;
    }>(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
    }

    const body = (bodyRead.value ?? {}) as {
      decision?: unknown;
      reason?: unknown;
    };

    const decision = body.decision;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (decision !== "approve" && decision !== "reject") {
      return fail(
        400,
        "VALIDATION_ERROR",
        'decision must be "approve" or "reject".'
      );
    }
    if (reason.length < 8) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "reason is required and must state the ground for the decision."
      );
    }

    return {
      idempotencyKey,
      decision,
      reason,
      requestHash: computeRequestHash(body)
    };
  },
  authorize: {
    moduleKey: "data_lifecycle",
    activityCode: "subject_erasure",
    action: "approve"
  },
  handler: async ({ tx, auth, prepared, params, tenantId, locals }) => {
    const requestId = params.id;

    if (!requestId) {
      return fail(400, "VALIDATION_ERROR", "Request id is required.");
    }

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

    const claim = await claimPendingErasure(
      tx,
      tenantId,
      requestId,
      auth.context.tenantUserId,
      { approved: prepared.decision === "approve", reason: prepared.reason }
    );

    if (!claim.claimed) {
      if (claim.reason === "not_found") {
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "No such pending erasure request in this tenant."
        );
      }
      if (claim.reason === "checker_is_maker") {
        // ADR-0094 Decision 3. Named explicitly rather than folded into a
        // generic conflict: the operator needs to know a DIFFERENT person must
        // decide, not that they should retry.
        return fail(
          409,
          "SOD_MAKER_IS_CHECKER",
          "An erasure must be approved by somebody other than the person who requested it."
        );
      }
      return fail(
        409,
        "REQUEST_NOT_PENDING",
        "That request has already been decided."
      );
    }

    let erasedTables: {
      key: string;
      tableName: string;
      rowsAffected: number;
    }[] = [];
    let skippedColumns: readonly string[] = [];
    let rowsAffected = 0;
    let tablesUnanswered = 0;

    if (prepared.decision === "approve") {
      const resolution = await resolveSubject(
        tx,
        tenantId,
        claim.request.subjectTenantUserId
      );

      if (!resolution.resolved) {
        // The membership disappeared between request and approval. Failing the
        // whole transaction rolls the claim back too, so the request stays
        // pending rather than being marked completed with nothing erased.
        return fail(
          404,
          "RESOURCE_NOT_FOUND",
          "The subject of that request no longer exists in this tenant."
        );
      }

      const plan = buildSubjectPlan(
        collectSubjectDataDescriptors(listModules()),
        resolution.subject
      );
      const targets = erasureTargets(plan);
      const columnTypes = await loadColumnTypes(
        tx,
        targets.map((entry) => entry.tableName)
      );
      const result = await runSubjectErasure(tx, tenantId, plan, columnTypes);

      erasedTables = result.outcomes.map((outcome) => ({
        key: outcome.key,
        tableName: outcome.tableName,
        rowsAffected: outcome.rowsAffected
      }));
      skippedColumns = result.skippedColumns;
      rowsAffected = result.outcomes.reduce(
        (sum, outcome) => sum + outcome.rowsAffected,
        0
      );
      tablesUnanswered = plan.unansweredEntries.length;

      await recordErasureOutcome(tx, tenantId, requestId, {
        tablesAnswered: targets.length,
        tablesUnanswered,
        rowsAffected
      });
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "data_lifecycle",
      action:
        prepared.decision === "approve"
          ? "subject_erasure.approved"
          : "subject_erasure.rejected",
      resourceType: "subject_request",
      resourceId: requestId,
      severity: "critical",
      message:
        prepared.decision === "approve"
          ? `Erasure approved and executed for tenant user ${claim.request.subjectTenantUserId}`
          : `Erasure rejected for tenant user ${claim.request.subjectTenantUserId}`,
      attributes: {
        subjectTenantUserId: claim.request.subjectTenantUserId,
        requestedBy: claim.request.requestedBy,
        reason: prepared.reason,
        rowsAffected,
        // Carried into the audit row, not just the response: a column the
        // engine could not write is the one thing a compliance reviewer would
        // most want to find later, and the response body is not kept.
        skippedColumns
      },
      correlationId: locals.correlationId ?? undefined
    });

    const successResponse = ok({
      request: { ...claim.request, rowsAffected, tablesUnanswered },
      erasedTables,
      skippedColumns
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
