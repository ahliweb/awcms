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
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { validateAbacPolicyInput } from "../../../../../modules/identity-access/domain/abac-policy";
import {
  getAbacPolicyById,
  updateAbacPolicy
} from "../../../../../modules/identity-access/application/abac-policy-directory";
import { invalidatePolicyCache } from "../../../../../modules/identity-access/application/policy-cache";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "abac_policies",
  action: "read" as const
};

const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "abac_policies",
  action: "configure" as const
};

export const GET: APIRoute = async ({ request, cookies, params }) => {
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

    const policy = await getAbacPolicyById(tx, tenantId, id);
    if (!policy) {
      return fail(404, "RESOURCE_NOT_FOUND", "Policy not found.");
    }
    return ok({ policy });
  });
};

export const PUT: APIRoute = async ({ request, cookies, params }) => {
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

  const bodyRead = await readJsonBody<Record<string, unknown>>(request);
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateAbacPolicyInput(bodyRead.value);
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "ABAC policy is invalid.",
      {},
      validation.errors
    );
  }
  const input = validation.value;

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

    // If the policyCode changed, guard against colliding with another row.
    if (input.policyCode !== existing.policyCode) {
      const duplicate = await tx`
        SELECT 1 FROM awcms_abac_policies
        WHERE tenant_id = ${tenantId} AND policy_code = ${input.policyCode}
          AND id <> ${id}
      `;
      if (duplicate[0]) {
        return fail(
          409,
          "RESOURCE_CONFLICT",
          "A policy with that policyCode already exists."
        );
      }
    }

    const record = await updateAbacPolicy(tx, tenantId, id, input);
    if (!record) {
      return fail(404, "RESOURCE_NOT_FOUND", "Policy not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "configure",
      resourceType: "abac_policy",
      resourceId: record.id,
      severity: "warning",
      message: "ABAC policy updated.",
      attributes: {
        policyCode: record.policyCode,
        effect: record.effect,
        moduleKey: record.moduleKey,
        activityCode: record.activityCode,
        action: record.action,
        resourceType: record.resourceType,
        dslVersion: record.dslVersion,
        priority: record.priority
      }
    });

    mutated = true;
    return ok({ policy: record });
  });

  if (mutated) {
    invalidatePolicyCache(tenantId);
  }
  return response;
};
