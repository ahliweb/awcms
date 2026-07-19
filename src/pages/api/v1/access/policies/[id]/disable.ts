import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import {
  getAbacPolicyById,
  setAbacPolicyActive
} from "../../../../../../modules/identity-access/application/abac-policy-directory";
import { invalidatePolicyCache } from "../../../../../../modules/identity-access/application/policy-cache";

const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "abac_policies",
  action: "configure" as const
};

export const POST: APIRoute = async ({ request, cookies, params }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }
  const id = params.id;
  if (!id) {
    return fail(400, "VALIDATION_ERROR", "Policy id is required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  let mutated = false;
  const response = await withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      CONFIGURE_GUARD
    );
    if (!auth.allowed) {
      return auth.denied;
    }

    const existing = await getAbacPolicyById(tx, tenantId, id);
    if (!existing) {
      return fail(404, "RESOURCE_NOT_FOUND", "Policy not found.");
    }

    const record = await setAbacPolicyActive(tx, tenantId, id, false);
    if (!record) {
      return fail(404, "RESOURCE_NOT_FOUND", "Policy not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "disable",
      resourceType: "abac_policy",
      resourceId: record.id,
      severity: "warning",
      message: "ABAC policy disabled.",
      attributes: { policyCode: record.policyCode, effect: record.effect }
    });

    mutated = true;
    return ok({ policy: record });
  });

  if (mutated) {
    invalidatePolicyCache(tenantId);
  }
  return response;
};
