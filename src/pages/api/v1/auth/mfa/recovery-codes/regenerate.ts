import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { regenerateRecoveryCodes } from "../../../../../../modules/identity-access/application/mfa";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/auth/mfa/recovery-codes/regenerate` (Issue #184) — high-risk,
 * self-service: invalidates every existing recovery code and issues 10 fresh
 * ones, shown exactly once. Requires a FRESH step-up (`requireStepUp`, Issue
 * #184 F2) so a stolen session cannot silently rotate a victim's recovery codes.
 */
export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { tenantId, token } = resolveAuthInputs(request, cookies);

  if (!tenantId)
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  if (!token) return fail(401, "AUTH_REQUIRED", "Authentication required.");

  const sql = getDatabaseClient();
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  return withTenant(sql, tenantId, async (tx) => {
    const stepUp = await requireStepUp(tx, tenantId, tokenHash, now);
    if (!stepUp.ok) return stepUp.denied;

    const identityId = stepUp.session.identityId;
    const result = await regenerateRecoveryCodes(tx, tenantId, identityId);

    if (!result.ok) {
      return fail(
        409,
        result.code,
        "Multi-factor authentication is not currently active for this account."
      );
    }

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_recovery_codes_regenerated",
      resourceType: "identity",
      resourceId: identityId,
      severity: "warning",
      message: "MFA recovery codes regenerated; previous codes invalidated.",
      correlationId: locals.correlationId
    });

    return ok({ recoveryCodes: result.recoveryCodes });
  });
};
