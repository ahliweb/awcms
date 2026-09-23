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
import { cancelQueuedJob } from "../../../../../../modules/omes-control/application/job-directory";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/omes/jobs/{id}/cancel` (Issue ahliweb/omes#198) — cancel a
 * `queued` job. Guarded by `omes_control.jobs.cancel`. Only `queued` jobs are
 * eligible: a `leased`/`running` job is already in flight on a worker this
 * endpoint has no channel to reach (AWCMS never talks to a host directly),
 * so those are refused with `409 JOB_NOT_CANCELLABLE` rather than silently
 * no-op'd.
 */
const IDEMPOTENCY_SCOPE = "omes_job_cancel";

type Prepared = { idempotencyKey: string };

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
  authorize: OMES_GUARDS.jobs.cancel,
  handler: async ({ tx, tenantId, auth, prepared, params, locals }) => {
    const id = params.id;

    if (!id) {
      return fail(400, "VALIDATION_ERROR", "Job id is required.");
    }

    const requestHash = computeRequestHash({ action: "cancel", jobId: id });
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
        action: "omes_control.jobs.cancel",
        resourceType: "omes_job",
        resourceId: id,
        severity: "warning",
        message:
          "OMES job cancel request replayed (Idempotency-Key reuse, same payload).",
        attributes: { idempotencyReplay: true },
        correlationId: locals.correlationId
      });

      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const outcome = await cancelQueuedJob(tx, tenantId, id);

    if (outcome.outcome === "not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Job not found.");
    }

    if (outcome.outcome === "not_cancellable") {
      return fail(
        409,
        "JOB_NOT_CANCELLABLE",
        `Job is "${outcome.currentState}" and can only be cancelled while "queued".`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.jobs.cancel",
      resourceType: "omes_job",
      resourceId: outcome.job.id,
      severity: "warning",
      message: "OMES job cancelled.",
      attributes: {
        serverId: outcome.job.serverId,
        operation: outcome.job.operation
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
