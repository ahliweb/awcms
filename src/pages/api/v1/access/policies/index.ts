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
  insertAbacPolicy,
  listAbacPolicies
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

    const policies = await listAbacPolicies(tx, tenantId);
    return ok({ policies });
  });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }
  if (!token) {
    return fail(401, "AUTH_REQUIRED", "Authentication required.");
  }

  const bodyRead = await readJsonBody<Record<string, unknown>>(request);
  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  // The crux: only VALID DSL can ever be stored. An invalid condition AST,
  // unknown attribute/operator, or wrong value type is rejected here before any
  // write — so an invalid policy can never exist, let alone be enabled.
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

  // Create disabled by default (authored, then explicitly enabled) unless the
  // caller opts into create-and-enable. Enabling is safe because the DSL is
  // already validated above.
  const isActive =
    bodyRead.value && typeof bodyRead.value.isActive === "boolean"
      ? bodyRead.value.isActive
      : false;

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

    const duplicate = await tx`
      SELECT 1 FROM awcms_abac_policies
      WHERE tenant_id = ${tenantId} AND policy_code = ${input.policyCode}
    `;
    if (duplicate[0]) {
      return fail(
        409,
        "RESOURCE_CONFLICT",
        "A policy with that policyCode already exists."
      );
    }

    const record = await insertAbacPolicy(tx, tenantId, input, isActive);

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "create",
      resourceType: "abac_policy",
      resourceId: record.id,
      severity: "warning",
      message: "ABAC policy created.",
      attributes: {
        policyCode: record.policyCode,
        effect: record.effect,
        moduleKey: record.moduleKey,
        activityCode: record.activityCode,
        action: record.action,
        resourceType: record.resourceType,
        dslVersion: record.dslVersion,
        priority: record.priority,
        isActive: record.isActive
      }
    });

    mutated = true;
    return ok({ policy: record });
  });

  // Invalidate AFTER commit (withTenant has resolved = committed), so the next
  // request never re-caches a pre-commit snapshot.
  if (mutated) {
    invalidatePolicyCache(tenantId);
  }
  return response;
};
