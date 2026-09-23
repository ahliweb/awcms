import { defineTenantRoute } from "../../../../../../../modules/_shared/tenant-route";
import {
  created,
  fail,
  jsonResponse
} from "../../../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../../modules/_shared/idempotency";
import { checkSharedRateLimit } from "../../../../../../../lib/security/rate-limit";
import { OMES_GUARDS } from "../../../../../../../modules/omes-control/domain/permissions";
import { issueEnrollmentChallengeForServer } from "../../../../../../../modules/omes-control/application/enrollment-management";
import { recordAuditEvent } from "../../../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_enrollment_challenge_issue";
const ISSUE_RATE_LIMIT = { maxAttempts: 20, windowMs: 60_000 };

type Prepared = { idempotencyKey: string };

/**
 * `POST /api/v1/omes/servers/{id}/enrollment-challenges` (Issue
 * ahliweb/omes#198) — mints a one-time enrollment challenge for a server
 * registered but not yet enrolled. Guarded by
 * `omes_control.enrollments.manage`. The raw challenge is returned in THIS
 * response only — never again (sql/158).
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
  authorize: OMES_GUARDS.enrollments.manage,
  handler: async ({ tx, tenantId, now, auth, prepared, params, locals }) => {
    const serverId = params.id;

    if (!serverId) {
      return fail(400, "VALIDATION_ERROR", "Server id is required.");
    }

    const requestHash = computeRequestHash({
      action: "issue_enrollment_challenge",
      serverId
    });
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
        action: "omes_control.enrollments.manage",
        resourceType: "omes_enrollment",
        severity: "warning",
        message: `Enrollment-challenge issuance request replayed for server ${serverId} (Idempotency-Key reuse, same payload).`,
        attributes: { serverId, idempotencyReplay: true },
        correlationId: locals.correlationId
      });

      // Deliberately NOT the original 201 response — see below: what is
      // stored for THIS scope is a redacted stand-in, never the raw
      // challenge, so a replay cannot resurrect a secret that was shown to
      // the caller exactly once on the original request.
      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const rateLimit = await checkSharedRateLimit(
      `omes-enrollment-challenge:${auth.context.tenantUserId}`,
      ISSUE_RATE_LIMIT,
      now.getTime()
    );

    if (!rateLimit.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many enrollment-challenge requests. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      );
    }

    const outcome = await issueEnrollmentChallengeForServer(
      tx,
      tenantId,
      serverId,
      now
    );

    if (outcome.outcome === "server_not_found") {
      return fail(404, "RESOURCE_NOT_FOUND", "Server not found.");
    }

    if (outcome.outcome === "server_not_eligible") {
      return fail(
        409,
        "SERVER_NOT_ELIGIBLE",
        `Server is "${outcome.status}" and cannot be issued a new enrollment challenge while in that state.`
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.enrollments.manage",
      resourceType: "omes_enrollment",
      resourceId: outcome.workerId,
      severity: "warning",
      message: `Enrollment challenge issued for server ${serverId}.`,
      attributes: {
        serverId,
        workerId: outcome.workerId,
        expiresAt: outcome.expiresAt
      },
      correlationId: locals.correlationId
    });

    // The LIVE response carries the raw challenge — this is the one and
    // only time it is ever shown. What gets PERSISTED to the idempotency
    // store (`awcms_idempotency_keys`, an ordinary table with no
    // secret-shaped-value scrubbing of its own) is a deliberately
    // DIFFERENT, redacted body: sql/158's whole discipline is "the raw
    // challenge is never persisted, only its hash" and a naive
    // save-then-replay of the same body as this response would silently
    // break that the moment a second request used this Idempotency-Key.
    const response = created({
      workerId: outcome.workerId,
      enrollmentChallenge: outcome.rawChallenge,
      expiresAt: outcome.expiresAt
    });

    const redactedReplayBody = await created({
      workerId: outcome.workerId,
      enrollmentChallenge: "[REDACTED_ALREADY_SHOWN_ONCE]",
      expiresAt: outcome.expiresAt
    })
      .clone()
      .json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      201,
      redactedReplayBody
    );

    return response;
  }
});
