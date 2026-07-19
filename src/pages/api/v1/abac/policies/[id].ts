import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { updatePolicy } from "../../../../../modules/identity-access/application/abac-admin";
import { validateUpdateAbacPolicyInput } from "../../../../../modules/identity-access/domain/abac-admin-validation";
import { invalidatePolicyCache } from "../../../../../modules/identity-access/application/policy-cache";

const UPDATE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "configure" as const
};

/**
 * `PATCH /api/v1/abac/policies/{id}` — update a policy's effect/description
 * and/or enable/disable it (Issue #171). One endpoint backs BOTH the edit form
 * and the enable/disable toggle. High-risk access-control change: gated on
 * `identity_access.access_control.configure` (the access-control administration
 * permission — the only seeded write action for this activity; there is no
 * `update`), audit-logged in the application layer. 404 when the policy does
 * not exist in this tenant.
 */
export const PATCH: APIRoute = async ({ request, params, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);
  const policyId = params.id;

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!policyId) return fail(400, "VALIDATION_ERROR", "Policy id is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const validation = validateUpdateAbacPolicyInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "ABAC policy update input is invalid.",
      {},
      validation.errors
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();
  const correlationId = locals.correlationId;

  // Like the create route: this flat #171 surface writes the same
  // `awcms_abac_policies` table the Issue #179 evaluator reads through a
  // tenant-keyed cache (effect/description/isActive changes ALL affect the
  // evaluator — a disabled policy stops applying, a flipped effect changes the
  // decision). Invalidate the cache AFTER commit so the change takes effect
  // without a restart and this endpoint never bypasses the evaluator.
  let mutated = false;
  const response = await withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      UPDATE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    const policy = await updatePolicy(
      tx,
      tenantId,
      auth.context.tenantUserId,
      policyId,
      validation.value,
      correlationId
    );
    if (!policy) return fail(404, "RESOURCE_NOT_FOUND", "Policy not found.");

    mutated = true;
    return ok(policy);
  });

  if (mutated) {
    invalidatePolicyCache(tenantId);
  }
  return response;
};
