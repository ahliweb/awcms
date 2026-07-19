import type { APIRoute } from "astro";

import { fail, ok } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { withTenant } from "../../../../lib/database/tenant-context";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { recordAuditEvent } from "../../../../modules/logging/application/audit-log";
import {
  getTenantAuthPolicy,
  saveTenantAuthPolicy
} from "../../../../modules/identity-access/application/tenant-auth-policy";
import { validateUpdateTenantAuthPolicyInput } from "../../../../modules/identity-access/domain/tenant-sso-policy";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_policy",
  action: "read" as const
};

const UPDATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "sso_policy",
  action: "update" as const
};

/** `GET /api/v1/auth/sso-policy` (Issue #185) — this tenant's authentication policy, falling back to the safe default (password login on, SSO off) when never configured. */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      READ_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const policy = await getTenantAuthPolicy(tx, tenantId);

    return ok(policy);
  });
};

/**
 * `PATCH /api/v1/auth/sso-policy` (Issue #185) — partial-update upsert, one row
 * per tenant. High-risk admin action: audited. Server-side break-glass
 * enforcement lives inside `saveTenantAuthPolicy`: a request that would leave
 * the tenant with `sso_required=true` (or `password_login_enabled=false`) and
 * no currently-eligible break-glass identity is rejected with
 * `409 BREAK_GLASS_REQUIRED`, never silently saved.
 */
export const PATCH: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateUpdateTenantAuthPolicyInput(bodyRead.value);

  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Tenant authentication policy update is invalid.",
      {},
      validation.errors
    );
  }

  const input = validation.value;
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      UPDATE_GUARD
    );

    if (!auth.allowed) {
      return auth.denied;
    }

    const result = await saveTenantAuthPolicy(
      tx,
      tenantId,
      auth.context.tenantUserId,
      input
    );

    if (result.outcome === "break_glass_required") {
      return fail(
        409,
        "BREAK_GLASS_REQUIRED",
        "sso_required=true or password_login_enabled=false requires at least one currently-active break-glass identity with an active tenant membership."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "sso_policy_updated",
      resourceType: "tenant_auth_policy",
      resourceId: tenantId,
      severity: "warning",
      message: "Tenant authentication policy updated.",
      // Counts only (never the ids themselves — redaction-safe) so a forensic
      // review can see that `saveTenantAuthPolicy` dropped ineligible/garbage
      // break-glass ids from this save, without a before/after DB snapshot.
      attributes:
        input.breakGlassIdentityIds !== undefined
          ? {
              breakGlassIdentityIdsSubmittedCount:
                input.breakGlassIdentityIds.length,
              breakGlassIdentityIdsPersistedCount:
                result.policy.breakGlassIdentityIds.length
            }
          : undefined,
      correlationId
    });

    return ok(result.policy);
  });
};
