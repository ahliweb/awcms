import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../../lib/database/client";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../../lib/security/auth-rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../../lib/security/request-body-limit";
import {
  enforceTurnstileIfRequired,
  INVITATION_ACCEPT_TURNSTILE_ACTION
} from "../../../../../../lib/security/turnstile";
import { resolveInvitationRateLimit } from "../../../../../../lib/auth/invitation-config";
import { fail, ok } from "../../../../../../modules/_shared/api-response";
import { acceptInvitation } from "../../../../../../modules/identity-access/application/invitation-acceptance";
import { withPublicAuthTenant } from "../../../../../../modules/identity-access/application/public-auth-tenant";
import { validateAcceptInvitationInput } from "../../../../../../modules/identity-access/domain/invitation-policy";
import { MIN_PASSWORD_LENGTH } from "../../../../../../modules/identity-access/domain/password-reset-validation";
import { recordAuditEvent } from "../../../../../../modules/logging/application/audit-log";

/**
 * `POST /api/v1/auth/invitations/{token}/accept` (ADR-0082, Gelombang 4 PR 4.2
 * of #423).
 *
 * The unauthenticated endpoint that CREATES AN ACCOUNT, which is why it carries
 * the fullest set of pre-flight refusals in this module: rate limit before any
 * database work, its own Turnstile action so a token solved on another form
 * cannot be spent here, and a body that declares no privilege field at all —
 * what the invitee may hold was decided by the administrator who invited them
 * and is read from `awcms_invitation_policies`, never from this request.
 *
 * ## It does not issue a session
 *
 * The invitee signs in at `/login` afterwards. Minting a session here would
 * route around the tenant's MFA policy, around `isPasswordLoginDisabledForIdentity`
 * for an SSO-only tenant, and around the login rate limit — three decisions
 * that belong to the login path and not to the endpoint that creates the
 * account.
 *
 * ## One refusal for everything
 *
 * Unknown, revoked, already-accepted, expired, wrong tenant, and an address
 * that acquired an account in the meantime all answer `404` with the same body.
 * Only the audit row distinguishes them.
 */
const GENERIC_INVALID_MESSAGE =
  "This invitation link is invalid or has expired.";

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = params.token;
  if (!token) {
    return fail(404, "RESOURCE_NOT_FOUND", GENERIC_INVALID_MESSAGE);
  }

  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "invitation-accept",
    config: resolveInvitationRateLimit()
  });
  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);
  const rawBody = bodyRead.value;

  const validation = validateAcceptInvitationInput(rawBody, (password) =>
    password.length < MIN_PASSWORD_LENGTH
      ? {
          field: "password",
          message: `password must be at least ${MIN_PASSWORD_LENGTH} characters.`
        }
      : null
  );
  if (!validation.valid) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "Invitation acceptance input is invalid.",
      {},
      validation.errors
    );
  }

  const turnstileResult = await enforceTurnstileIfRequired(
    (rawBody as Record<string, unknown> | null)?.turnstileToken,
    clientIp,
    { action: INVITATION_ACCEPT_TURNSTILE_ACTION }
  );
  if (!turnstileResult.ok) {
    return fail(
      400,
      turnstileResult.code,
      turnstileResult.code === "TURNSTILE_REQUIRED"
        ? "Turnstile verification token is required."
        : "Turnstile verification failed."
    );
  }

  const sql = getDatabaseClient();

  return withPublicAuthTenant(
    sql,
    tenantId,
    { workClass: "interactive" },
    async (tx) => {
      const now = new Date();
      const result = await acceptInvitation(
        tx,
        tenantId,
        token,
        validation.value,
        now
      );

      const source = {
        ipHash: hashClientIp(clientIp),
        userAgent: summarizeUserAgent(request)
      };

      if (result.outcome !== "accepted") {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "identity_access",
          action: "invitation_accept_failed",
          resourceType: "invitation",
          severity: "warning",
          message: "An invitation acceptance was refused.",
          attributes: {
            reason:
              result.outcome === "invalid" ? result.reason : result.outcome,
            ...source
          }
        });

        // Returned from INSIDE the transaction, which COMMITS — deliberately.
        // The audit row above is the record of a failed acceptance and must
        // survive; every refusal in `acceptInvitation` precedes its first
        // write, so nothing else was mutated on this path.
        return fail(404, "RESOURCE_NOT_FOUND", GENERIC_INVALID_MESSAGE);
      }

      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "invitation_accepted",
        resourceType: "invitation",
        resourceId: result.invitationId,
        severity: "warning",
        message: "An invitation was accepted and a membership was created.",
        attributes: {
          identityId: result.identityId,
          tenantUserId: result.tenantUserId,
          roleCodes: result.grantedRoleCodes,
          ...source
        }
      });

      return ok({ accepted: true });
    }
  );
};
