import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { hashSessionToken } from "../../../../../../lib/auth/session-token";
import { resolveAuthInputs } from "../../../../../../modules/identity-access/application/access-guard";
import { requireStepUp } from "../../../../../../modules/identity-access/application/mfa-session-assurance";
import { disableMfa } from "../../../../../../modules/identity-access/application/mfa";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";
import { createEmailAuthNotificationAdapter } from "../../../../../../modules/email/application/auth-notification-port-adapter";
import { notifyMfaChange } from "../../../../../../modules/identity-access/application/mfa-security-notice";
import { resolveClientIp } from "../../../../../../lib/security/rate-limit";

/**
 * `POST /api/v1/auth/mfa/totp/disable` (Issue #184) — high-risk, self-service:
 * the authenticated identity turns off its own MFA. Requires a FRESH step-up
 * (`requireStepUp`, Issue #184 F2): "regenerate/revoke dengan re-authentication"
 * — a stolen session cannot tear MFA down without re-proving the factor within
 * the step-up window. Not gated on `AUTH_MFA_ENABLED` (an operator must be able
 * to disable an existing factor even after the enrollment feature is off).
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  clientAddress
}) => {
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
    const result = await disableMfa(tx, tenantId, identityId, now);

    if (!result.ok) {
      return fail(
        409,
        result.code,
        "Multi-factor authentication is not currently active for this account."
      );
    }

    // Removing a factor is half of "replacing" one (#1004): the owner is told
    // out of band, exactly as for an enrolment.
    const notice = await notifyMfaChange(tx, {
      tenantId,
      identityId,
      kind: "disabled",
      notifications: createEmailAuthNotificationAdapter(),
      occurredAt: now,
      clientIp: resolveClientIp(request, clientAddress),
      correlationId: locals.correlationId
    });

    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: "identity_access",
      action: "mfa_disabled",
      resourceType: "identity",
      resourceId: identityId,
      severity: "warning",
      message: "Multi-factor authentication disabled.",
      attributes: { notified: notice.delivered },
      correlationId: locals.correlationId
    });

    return ok({ disabled: true });
  });
};
