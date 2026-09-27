import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  created,
  fail,
  jsonResponse
} from "../../../../../modules/_shared/api-response";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { readJsonBody } from "../../../../../lib/security/request-body-limit";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  AI_EGRESS_APPROVABLE_CLASSIFICATIONS,
  AI_EGRESS_APPROVABLE_DESTINATIONS,
  AI_EGRESS_APPROVABLE_REASON_CODES
} from "../../../../../modules/omes-control/domain/ai-privacy";
import { submitAiEgressApproval } from "../../../../../modules/omes-control/application/ai-egress-approval";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_ai_egress_approval";
const APPROVAL_RATE_LIMIT = { maxAttempts: 20, windowMs: 60_000 };
const JUSTIFICATION_MAX_LENGTH = 500;

type Prepared = {
  idempotencyKey: string;
  serverId: string;
  deploymentId?: string;
  policyVersion: string;
  classification: string;
  destination: string;
  reasonCode: string;
  justification?: string;
  approve: boolean;
};

/**
 * `POST /api/v1/omes/ai-privacy/egress-approvals` (Issue ahliweb/omes#232,
 * OMES issue #217) — an owner recording an approve/deny decision on an
 * `approval_required` AI egress policy decision.
 *
 * **UI hiding is never the enforcement boundary.** Even though the admin
 * screen never renders an approve control for a RESTRICTED->cloud_sanitized
 * combination, this handler independently re-validates every field and
 * calls `submitAiEgressApproval`, which itself calls the pure
 * `authorizeAiEgressApproval` gate BEFORE ever touching the
 * `workflow-approval` engine — see that function's own header for the full
 * three-layer (RBAC, application value-check, DB CHECK constraint) defense.
 */
export const POST = defineTenantRoute<Prepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<Prepared | Response> => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return fail(
        400,
        "IDEMPOTENCY_REQUIRED",
        "Idempotency-Key header is required."
      );
    }

    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return fail(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
    }
    if (bodyRead.malformed) {
      return fail(400, "VALIDATION_ERROR", "Request body must be JSON.");
    }

    const body: unknown = bodyRead.value;

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return fail(
        400,
        "VALIDATION_ERROR",
        "Request body must be a JSON object."
      );
    }

    const record = body as Record<string, unknown>;
    const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
    const isValidId = (value: unknown): value is string =>
      typeof value === "string" && ID_PATTERN.test(value);

    if (!isValidId(record.serverId)) {
      return fail(400, "VALIDATION_ERROR", "serverId is required.");
    }
    if (record.deploymentId !== undefined && !isValidId(record.deploymentId)) {
      return fail(400, "VALIDATION_ERROR", "deploymentId is invalid.");
    }
    if (!isValidId(record.policyVersion)) {
      return fail(400, "VALIDATION_ERROR", "policyVersion is required.");
    }
    if (
      typeof record.classification !== "string" ||
      !(AI_EGRESS_APPROVABLE_CLASSIFICATIONS as readonly string[]).includes(
        record.classification
      )
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `classification must be one of: ${AI_EGRESS_APPROVABLE_CLASSIFICATIONS.join(", ")}.`
      );
    }
    if (
      typeof record.destination !== "string" ||
      !(AI_EGRESS_APPROVABLE_DESTINATIONS as readonly string[]).includes(
        record.destination
      )
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `destination must be one of: ${AI_EGRESS_APPROVABLE_DESTINATIONS.join(", ")}.`
      );
    }
    if (
      typeof record.reasonCode !== "string" ||
      !(AI_EGRESS_APPROVABLE_REASON_CODES as readonly string[]).includes(
        record.reasonCode
      )
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `reasonCode must be one of: ${AI_EGRESS_APPROVABLE_REASON_CODES.join(", ")}.`
      );
    }
    if (
      record.justification !== undefined &&
      (typeof record.justification !== "string" ||
        record.justification.length > JUSTIFICATION_MAX_LENGTH)
    ) {
      return fail(
        400,
        "VALIDATION_ERROR",
        `justification must be a string of at most ${JUSTIFICATION_MAX_LENGTH} characters.`
      );
    }
    if (typeof record.approve !== "boolean") {
      return fail(400, "VALIDATION_ERROR", "approve must be a boolean.");
    }

    return {
      idempotencyKey,
      serverId: record.serverId,
      deploymentId: record.deploymentId as string | undefined,
      policyVersion: record.policyVersion,
      classification: record.classification,
      destination: record.destination,
      reasonCode: record.reasonCode,
      justification: record.justification as string | undefined,
      approve: record.approve
    };
  },
  authorize: OMES_GUARDS.aiPrivacy.approve,
  handler: async ({ tx, tenantId, now, auth, prepared, locals }) => {
    const requestHash = computeRequestHash({
      action: "ai_egress_approval",
      prepared
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
        action: "omes_control.ai_privacy.approve",
        resourceType: "omes_ai_egress_approval",
        severity: "critical",
        message: `AI egress approval request replayed (Idempotency-Key reuse, same payload).`,
        attributes: { serverId: prepared.serverId, idempotencyReplay: true },
        correlationId: locals.correlationId
      });

      return jsonResponse(existing.responseBody, {
        status: existing.responseStatus
      });
    }

    const rateLimit = await checkSharedRateLimit(
      `omes-ai-egress-approval:${auth.context.tenantUserId}`,
      APPROVAL_RATE_LIMIT,
      now.getTime()
    );

    if (!rateLimit.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many approval requests. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      );
    }

    const outcome = await submitAiEgressApproval(
      tx,
      tenantId,
      auth.context.tenantUserId,
      {
        correlationId: locals.correlationId ?? crypto.randomUUID(),
        idempotencyKey: prepared.idempotencyKey,
        serverId: prepared.serverId,
        deploymentId: prepared.deploymentId,
        policyVersion: prepared.policyVersion,
        classification: prepared.classification,
        destination: prepared.destination,
        reasonCode: prepared.reasonCode,
        justification: prepared.justification,
        approve: prepared.approve
      },
      now,
      locals.correlationId
    );

    if (outcome.outcome === "denied_structurally") {
      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "omes_control",
        action: "omes_control.ai_privacy.approve",
        resourceType: "omes_ai_egress_approval",
        severity: "critical",
        message: `AI egress approval request denied structurally: ${outcome.reasonCode}.`,
        attributes: {
          serverId: prepared.serverId,
          classification: prepared.classification,
          destination: prepared.destination,
          reasonCode: outcome.reasonCode
        },
        correlationId: locals.correlationId
      });

      return fail(
        422,
        "AI_EGRESS_APPROVAL_DENIED",
        outcome.reason,
        {},
        { reasonCode: outcome.reasonCode }
      );
    }

    if (outcome.outcome === "approval_workflow_not_configured") {
      return fail(
        409,
        "APPROVAL_WORKFLOW_NOT_CONFIGURED",
        'This tenant has not published an active approval workflow for AI egress decisions. Publish one under workflow key "omes_control.ai_egress_approval" via /admin/approvals before submitting an approval.'
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.ai_privacy.approve",
      resourceType: "omes_ai_egress_approval",
      resourceId: outcome.approval.id,
      severity: "critical",
      message: `AI egress approval ${outcome.approval.decision} for server ${prepared.serverId}.`,
      attributes: {
        serverId: prepared.serverId,
        classification: prepared.classification,
        destination: prepared.destination,
        decision: outcome.approval.decision
      },
      correlationId: locals.correlationId
    });

    const response = created({ approval: outcome.approval });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      prepared.idempotencyKey,
      requestHash,
      201,
      responseBody
    );

    return response;
  }
});
