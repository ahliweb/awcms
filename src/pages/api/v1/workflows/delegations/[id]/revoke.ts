import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  revokeWorkflowDelegation,
  WorkflowDelegationForbiddenError,
  WorkflowDelegationNotFoundError
} from "../../../../../../modules/workflow-approval/application/workflow-delegation-directory";

/**
 * Security-auditor finding (PR #778): this route previously gated on
 * `workflow.delegation.read` and relied solely on `revokeWorkflowDelegation`'s
 * ownership check ("only the delegator may revoke their own delegation")
 * — leaving the distinct `workflow.delegation.revoke` permission seeded
 * in migration `060` and doc 17's RBAC matrix (Owner/Manager: `RCV`)
 * completely unenforced (dead permission). Fixed to gate on
 * `workflow.delegation.revoke` — the ownership check in
 * `revokeWorkflowDelegation` remains as defense-in-depth on top of the
 * permission gate (a caller must hold BOTH the permission AND be the
 * original delegator); a future administrative-override revoke (any
 * delegation, not just one's own) would still be a distinct, separately
 * permissioned action, not built here.
 */
const REVOKE_GUARD = {
  moduleKey: "workflow",
  activityCode: "delegation",
  action: "revoke" as const
};
const REVOKE_IDEMPOTENCY_SCOPE = "workflow_delegation_revoke";
const MAX_REASON_LENGTH = 500;

type RevokeRequestBody = { reason?: unknown };

export const POST: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const id = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!id) return fail(400, "VALIDATION_ERROR", "Delegation id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return fail(
      400,
      "IDEMPOTENCY_REQUIRED",
      "Idempotency-Key header is required."
    );
  }

  const bodyRead = await readJsonBody<RevokeRequestBody>(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const reason =
    typeof bodyRead.value?.reason === "string"
      ? bodyRead.value.reason.trim()
      : undefined;

  if (reason !== undefined && reason.length > MAX_REASON_LENGTH) {
    return fail(
      400,
      "VALIDATION_ERROR",
      `reason must be at most ${MAX_REASON_LENGTH} characters.`
    );
  }

  const requestHash = computeRequestHash({ id, reason });
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        REVOKE_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const existingIdempotency = await findIdempotencyRecord(
        tx,
        tenantId,
        REVOKE_IDEMPOTENCY_SCOPE,
        idempotencyKey
      );

      if (existingIdempotency) {
        if (existingIdempotency.requestHash !== requestHash) {
          return fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used with a different request."
          );
        }
        return jsonResponse(existingIdempotency.responseBody, {
          status: existingIdempotency.responseStatus
        });
      }

      try {
        const revoked = await revokeWorkflowDelegation(tx, {
          tenantId,
          delegationId: id,
          revokedByTenantUserId: auth.context.tenantUserId,
          revokeReason: reason,
          correlationId: locals.correlationId
        });

        await recordAuditEvent(tx, {
          tenantId,
          actorTenantUserId: auth.context.tenantUserId,
          moduleKey: "workflow",
          action: "revoke",
          resourceType: "workflow_delegation",
          resourceId: revoked.id,
          severity: "warning",
          message: `Workflow delegation revoked.`,
          attributes: { reason },
          correlationId: locals.correlationId
        });

        const successResponse = ok(
          { id: revoked.id, status: revoked.status },
          { correlationId: locals.correlationId }
        );
        const successBody = await successResponse.clone().json();

        await saveIdempotencyRecord(
          tx,
          tenantId,
          REVOKE_IDEMPOTENCY_SCOPE,
          idempotencyKey,
          requestHash,
          200,
          successBody
        );

        return successResponse;
      } catch (error) {
        if (error instanceof WorkflowDelegationNotFoundError) {
          return fail(404, "RESOURCE_NOT_FOUND", error.message);
        }
        if (error instanceof WorkflowDelegationForbiddenError) {
          return fail(403, "ACCESS_DENIED", error.message);
        }
        throw error;
      }
    },
    { workClass: "interactive" }
  );
};
