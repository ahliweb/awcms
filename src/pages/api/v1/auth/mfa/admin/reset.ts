import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import {
  authorizeInTransaction,
  resolveAuthInputs
} from "../../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { adminResetMfa } from "../../../../../../modules/identity-access/application/mfa";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

const RESET_GUARD = {
  moduleKey: "identity_access",
  activityCode: "mfa_admin",
  action: "reset" as const
};

type AdminResetBody = { identityId?: unknown; reason?: unknown };

/**
 * `POST /api/v1/auth/mfa/admin/reset` (Issue #184) — administrative MFA reset.
 * Gated on the dedicated `identity_access.mfa_admin.reset` permission
 * (default-deny), demands a mandatory `reason`, audits at `critical`, and
 * refuses self-reset: an admin cannot clear their OWN factor through this
 * privileged path (that would be a factor bypass) — they must use self-service
 * `disable` behind their own already-MFA'd session.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const body = (await request
    .json()
    .catch(() => null)) as AdminResetBody | null;

  if (
    !body ||
    typeof body.identityId !== "string" ||
    typeof body.reason !== "string" ||
    body.reason.trim().length === 0
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "identityId and a non-empty reason are required."
    );
  }

  const targetIdentityId = body.identityId;
  const reason = body.reason.trim();
  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      tenantId,
      tokenHash,
      now,
      RESET_GUARD
    );
    if (!auth.allowed) return auth.denied;

    // Step-up gate (Issue #184 F3): even a permission-holding admin must have a
    // FRESH second-factor proof to reset another user's MFA.
    const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);
    if (!stepUp.ok) return stepUp.denied;

    if (auth.context.identityId === targetIdentityId) {
      return fail(
        403,
        "MFA_SELF_RESET_FORBIDDEN",
        "You cannot administratively reset your own MFA; use self-service disable instead."
      );
    }

    const result = await adminResetMfa(tx, tenantId, targetIdentityId, now);

    if (!result.ok) {
      return fail(404, result.code, "Target identity not found.");
    }

    await recordAuditEvent(tx, {
      tenantId,
      actorTenantUserId: auth.context.tenantUserId,
      moduleKey: "identity_access",
      action: "mfa_admin_reset",
      resourceType: "identity",
      resourceId: targetIdentityId,
      severity: "critical",
      message: "MFA administratively reset for another user.",
      attributes: { reason, hadFactor: result.hadFactor },
      correlationId: locals.correlationId
    });

    return ok({ reset: true, hadFactor: result.hadFactor });
  });
};
