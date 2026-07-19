import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withTenant } from "../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../modules/identity-access/application/mfa-session-assurance";
import {
  getTenantMfaPolicy,
  saveTenantMfaPolicy
} from "../../../../../modules/identity-access/application/tenant-mfa-policy";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

const READ_GUARD = {
  moduleKey: "identity_access",
  activityCode: "mfa_admin",
  action: "reset" as const
};
const CONFIGURE_GUARD = {
  moduleKey: "identity_access",
  activityCode: "mfa_admin",
  action: "configure" as const
};

type PolicyBody = { enforcementLevel?: unknown };

/**
 * `GET /api/v1/auth/mfa/policy` (Issue #184) — the tenant's MFA enforcement
 * policy. Read gated on `identity_access.mfa_admin.reset` (any MFA admin).
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

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
    if (!auth.allowed) return auth.denied;

    const policy = await getTenantMfaPolicy(tx, tenantId);
    return ok(policy);
  });
};

/**
 * `PUT /api/v1/auth/mfa/policy` (Issue #184) — set the tenant enforcement level
 * (`optional` | `required_for_privileged` | `required_for_all`). Gated on the
 * dedicated `identity_access.mfa_admin.configure` permission; audited.
 */
export const PUT: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const body = (await request.json().catch(() => null)) as PolicyBody | null;

  if (!body) {
    return fail(400, "VALIDATION_ERROR", "enforcementLevel is required.");
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
      CONFIGURE_GUARD
    );
    if (!auth.allowed) return auth.denied;

    // Step-up gate (Issue #184 F3): changing the tenant MFA enforcement policy
    // is a high-risk action and requires a fresh second-factor proof.
    const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);
    if (!stepUp.ok) return stepUp.denied;

    const result = await saveTenantMfaPolicy(
      tx,
      tenantId,
      auth.context.tenantUserId,
      body.enforcementLevel
    );

    if (!result.ok) {
      return fail(
        400,
        result.code,
        "enforcementLevel must be one of: optional, required_for_privileged, required_for_all."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "mfa_policy_updated",
      resourceType: "tenant",
      resourceId: tenantId,
      severity: "warning",
      message: `Tenant MFA enforcement set to ${result.policy.enforcementLevel}.`,
      attributes: { enforcementLevel: result.policy.enforcementLevel },
      correlationId: locals.correlationId
    });

    return ok(result.policy);
  });
};
