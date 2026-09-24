import { defineTenantRoute } from "../../../../../../modules/_shared/tenant-route";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { OMES_GUARDS } from "../../../../../../modules/omes-control/domain/permissions";
import { retryFailedJob } from "../../../../../../modules/omes-control/application/job-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_job_approve";

type Prepared = { idempotencyKey: string };

/**
 * `POST /api/v1/omes/jobs/{id}/approve` (Issue ahliweb/omes#198) — guarded
 * by `omes_control.jobs.approve`. See `application/job-directory.ts`'s
 * `retryFailedJob` header for why this is a bounded `failed -> queued`
 * requeue rather than a second, independent approval authority.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: ({ request }): Prepared | Response => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    return { idempotencyKey };
  },
  authorize: OMES_GUARDS.jobs.approve,
  handler: async ({ tx, tenantId, auth, prepared, params, locals }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Job id is required.");
    }

    const requestHash = computeRequestHash({ action: "approve", jobId: id });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency-Key was already used with a different request."
        );
      }

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "omes_control",
        action: "omes_control.jobs.approve",
        resourceType: "omes_job",
        resourceId: id,
        severity: "warning",
        message:
          "OMES job retry-approval request replayed (Idempotency-Key reuse, same payload).",
        attributes: { idempotencyReplay: true },
        correlationId: locals.correlationId
      });

      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const outcome = await retryFailedJob(tx, tenantId, id);

    if (outcome.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Job not found.");
    }

    if (outcome.outcome === "not_retryable") {
      return fail(
        409,
        "JOB_NOT_RETRYABLE",
        `Job is "${outcome.currentState}" and can only be approved for retry while "failed".`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.jobs.approve",
      resourceType: "omes_job",
      resourceId: outcome.job.id,
      severity: "warning",
      message: "OMES job approved for retry.",
      attributes: {
        serverId: outcome.job.serverId,
        operation: outcome.job.operation,
        retryCount: outcome.job.retryCount
      },
      correlationId: locals.correlationId
    });

    const response = ok({ job: outcome.job });
    const body = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      200,
      body
    );

    return response;
  }
});
