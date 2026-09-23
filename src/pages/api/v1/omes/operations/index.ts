import { defineTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  created,
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { decodeKeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import type { KeysetCursor } from "../../../../../modules/_shared/keyset-pagination";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { checkSharedRateLimit } from "../../../../../lib/security/rate-limit";
import { OMES_GUARDS } from "../../../../../modules/omes-control/domain/permissions";
import {
  OMES_OPERATION_GUARD,
  validateOperationSubmission,
  type OmesOperationCode,
  type OperationSubmissionInput
} from "../../../../../modules/omes-control/domain/operations";
import { fetchOperationRequests } from "../../../../../modules/omes-control/application/operation-directory";
import { submitOmesOperation } from "../../../../../modules/omes-control/application/operation-submission";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

const IDEMPOTENCY_SCOPE = "omes_operation_submit";

/**
 * Bounds how often ONE authenticated principal can submit an OMES operation.
 * Keyed on the actor (never the tenant header — Issue #447/skill
 * `awcms-new-endpoint`'s rule, matching `tenant/domains/[id]/verify.ts`),
 * resolved only AFTER authorization inside the transaction.
 */
const OPERATION_SUBMIT_RATE_LIMIT = { maxAttempts: 30, windowMs: 60_000 };

type ListPrepared = {
  serverId: string | null;
  status: string | null;
  cursor: KeysetCursor | undefined;
};

const LIST_VALID_STATUSES = new Set([
  "requested",
  "approved",
  "rejected",
  "dispatched",
  "completed",
  "failed"
]);

export const GET = defineTenantRoute<ListPrepared>({
  workClass: "interactive",
  prepare: ({ url }): ListPrepared | Response => {
    const status = url.searchParams.get("status");
    if (status !== null && !LIST_VALID_STATUSES.has(status)) {
      return fail(400, "VALIDATION_ERROR", "status is not a known value.");
    }

    const serverId = url.searchParams.get("serverId");
    const rawCursor = url.searchParams.get("cursor");

    if (rawCursor === null) {
      return { serverId, status, cursor: undefined };
    }

    const cursor = decodeKeysetCursor(rawCursor);
    if (!cursor) {
      return fail(400, "VALIDATION_ERROR", "cursor is not a valid cursor.");
    }

    return { serverId, status, cursor };
  },
  // Listing operation requests correlates 1:1 with deployment operate/rollback
  // intent — reuses `deployments.read` rather than inventing a dedicated
  // `operations.read` activity the seeded catalog (sql/155) does not have.
  authorize: OMES_GUARDS.deployments.read,
  handler: async ({ tx, tenantId, prepared }) =>
    ok(
      await fetchOperationRequests(tx, tenantId, {
        serverId: prepared.serverId ?? undefined,
        status: prepared.status ?? undefined,
        cursor: prepared.cursor
      })
    )
});

type SubmitPrepared =
  | { valid: true; idempotencyKey: string; input: OperationSubmissionInput }
  | { valid: false; response: Response };

export const POST = defineTenantRoute<SubmitPrepared>({
  workClass: "interactive",
  prepare: async ({ request }): Promise<SubmitPrepared> => {
    const idempotencyKey = request.headers.get("idempotency-key");

    if (!idempotencyKey) {
      return {
        valid: false,
        response: fail(
          400,
          "IDEMPOTENCY_REQUIRED",
          "Idempotency-Key header is required."
        )
      };
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return {
        valid: false,
        response: fail(
          400,
          "VALIDATION_ERROR",
          "Request body must be valid JSON."
        )
      };
    }

    const validation = validateOperationSubmission(body);

    if (!validation.valid) {
      return {
        valid: false,
        response: fail(
          400,
          "VALIDATION_ERROR",
          "Operation submission is invalid.",
          {},
          validation.errors
        )
      };
    }

    return { valid: true, idempotencyKey, input: validation.value };
  },
  // FUNCTION form: the permission required depends on the submitted
  // `operation` (`OMES_OPERATION_GUARD`), matching `tenant-route.ts`'s own
  // documented rationale for this shape. When `prepare` refused (bad body,
  // missing header) there is no `operation` to pick a guard from —
  // `deployments.read` is used as the floor so the refusal is still
  // authorization-gated rather than reachable pre-auth (mirrors the
  // documented `heldPrepareRefusal` carve-out).
  authorize: ({ prepared }) =>
    prepared.valid
      ? OMES_OPERATION_GUARD[prepared.input.operation as OmesOperationCode]
      : OMES_GUARDS.deployments.read,
  handler: async ({ tx, tenantId, auth, prepared, locals }) => {
    if (!prepared.valid) {
      return prepared.response;
    }

    const { idempotencyKey, input } = prepared;

    const requestHash = computeRequestHash({
      action: "submit_operation",
      input
    });
    const existing = await findIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey
    );

    if (existing) {
      if (existing.requestHash !== requestHash) {
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

    const rateLimit = await checkSharedRateLimit(
      `omes-operation-submit:${auth.context.tenantUserId}`,
      OPERATION_SUBMIT_RATE_LIMIT,
      Date.now()
    );

    if (!rateLimit.allowed) {
      return fail(
        429,
        "RATE_LIMITED",
        "Too many operation submissions. Try again shortly.",
        {},
        undefined,
        { "retry-after": String(rateLimit.retryAfterSec) }
      );
    }

    const now = new Date();
    const outcome = await submitOmesOperation(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input,
      now,
      locals.correlationId
    );

    if (outcome.outcome === "approval_workflow_not_configured") {
      return fail(
        409,
        "APPROVAL_WORKFLOW_NOT_CONFIGURED",
        'This tenant has not published an active approval workflow for destructive OMES operations. Publish one under workflow key "omes_control.destructive_operation" via /admin/approvals before submitting this operation.'
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "omes_control",
      action: "omes_control.operations.submit",
      resourceType: "omes_operation_request",
      resourceId: outcome.operationRequest.id,
      severity: "warning",
      message: `OMES operation "${input.operation}" submitted for server ${input.serverId}.`,
      attributes: {
        operation: input.operation,
        serverId: input.serverId,
        status: outcome.operationRequest.status
      },
      correlationId: locals.correlationId
    });

    const response = created({ operationRequest: outcome.operationRequest });
    const responseBody = await response.clone().json();

    await saveIdempotencyRecord(
      tx,
      tenantId,
      IDEMPOTENCY_SCOPE,
      idempotencyKey,
      requestHash,
      201,
      responseBody
    );

    return response;
  }
});
