import type { APIRoute } from "astro";
import {
  fail,
  jsonResponse,
  ok
} from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../../../../modules/_shared/idempotency";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import {
  createWorkflowDelegation,
  listWorkflowDelegations,
  type WorkflowDelegationRow
} from "../../../../../modules/workflow-approval/application/workflow-delegation-directory";
import { validateCreateDelegationRequestBody } from "../../../../../modules/workflow-approval/domain/workflow-delegation";

const READ_GUARD = {
  moduleKey: "workflow",
  activityCode: "delegation",
  action: "read" as const
};
const CREATE_GUARD = {
  moduleKey: "workflow",
  activityCode: "delegation",
  action: "create" as const
};
const CREATE_IDEMPOTENCY_SCOPE = "workflow_delegation_create";

function serializeDelegation(row: WorkflowDelegationRow) {
  return {
    id: row.id,
    delegatorTenantUserId: row.delegator_tenant_user_id,
    delegateTenantUserId: row.delegate_tenant_user_id,
    workflowKey: row.workflow_key ?? undefined,
    resourceType: row.resource_type ?? undefined,
    effectiveFrom: row.effective_from.toISOString(),
    effectiveTo: row.effective_to ? row.effective_to.toISOString() : undefined,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at ? row.revoked_at.toISOString() : undefined
  };
}

/**
 * `GET /api/v1/workflows/delegations` (Issue #747) — a tenant user's OWN
 * delegations (as delegator) by default; a caller with
 * `workflow.delegation.read` sees all (the endpoint does not further
 * restrict by caller — this permission is the same "operator-level read"
 * scope every other admin list endpoint in this base uses).
 */
export const GET: APIRoute = async ({ request, url, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const delegatorTenantUserId =
    url.searchParams.get("delegatorTenantUserId") ?? undefined;

  return withTenant(
    sql,
    tenantId,
    async (tx) => {
      const auth = await authorizeInTransaction(
        tx,
        tenantId,
        tokenHash,
        now,
        READ_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const rows = await listWorkflowDelegations(
        tx,
        tenantId,
        delegatorTenantUserId
      );

      return ok(
        { delegations: rows.map(serializeDelegation) },
        { correlationId: locals.correlationId }
      );
    },
    { workClass: "interactive" }
  );
};

/**
 * `POST /api/v1/workflows/delegations` (Issue #747) — creates a
 * delegation FROM the calling tenant user (a tenant user can only
 * delegate their OWN standing, never a third party's — see
 * `domain/workflow-delegation.ts`'s doc comment). Security-auditor
 * finding (PR #778): this route was missing both `Idempotency-Key`
 * enforcement and an audit log entry — a delegation broadens who can act
 * on the delegator's behalf, so both are added here, matching the
 * pattern every other high-risk workflow mutation in this module uses.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

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
        CREATE_GUARD
      );
      if (!auth.allowed) return auth.denied;

      const validation = validateCreateDelegationRequestBody(
        bodyRead.value,
        auth.context.tenantUserId
      );

      if (!validation.valid) {
        return fail(
          400,
          "VALIDATION_ERROR",
          "Delegation input is invalid.",
          {},
          validation.errors
        );
      }

      const requestHash = computeRequestHash({
        tenantUserId: auth.context.tenantUserId,
        ...validation.value
      });

      const existingIdempotency = await findIdempotencyRecord(
        tx,
        tenantId,
        CREATE_IDEMPOTENCY_SCOPE,
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

      const created = await createWorkflowDelegation(tx, {
        tenantId,
        delegatorTenantUserId: auth.context.tenantUserId,
        delegateTenantUserId: validation.value.delegateTenantUserId,
        workflowKey: validation.value.workflowKey,
        resourceType: validation.value.resourceType,
        effectiveFrom: validation.value.effectiveFrom,
        effectiveTo: validation.value.effectiveTo,
        reason: validation.value.reason,
        correlationId: locals.correlationId
      });

      await recordAuditEvent(tx, {
        tenantId,
        actorTenantUserId: auth.context.tenantUserId,
        moduleKey: "workflow",
        action: "create",
        resourceType: "workflow_delegation",
        resourceId: created.id,
        severity: "info",
        message: `Workflow delegation created (delegate ${created.delegate_tenant_user_id}).`,
        attributes: {
          delegateTenantUserId: created.delegate_tenant_user_id,
          workflowKey: created.workflow_key ?? undefined,
          resourceType: created.resource_type ?? undefined
        },
        correlationId: locals.correlationId
      });

      const successResponse = ok(
        { delegation: serializeDelegation(created) },
        { correlationId: locals.correlationId }
      );
      const successBody = await successResponse.clone().json();

      await saveIdempotencyRecord(
        tx,
        tenantId,
        CREATE_IDEMPOTENCY_SCOPE,
        idempotencyKey,
        requestHash,
        200,
        successBody
      );

      return successResponse;
    },
    { workClass: "interactive" }
  );
};
