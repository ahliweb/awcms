import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../../lib/database/client";
import {
  hashClientIp,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../lib/security/auth-rate-limit";
import { resolveInvitationRateLimit } from "../../../../../lib/auth/invitation-config";
import { fail, ok } from "../../../../../modules/_shared/api-response";
import { previewInvitation } from "../../../../../modules/identity-access/application/invitation-acceptance";
import { withPublicAuthTenant } from "../../../../../modules/identity-access/application/public-auth-tenant";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";

/**
 * `GET /api/v1/auth/invitations/{token}` — preview (ADR-0082, Gelombang 4 PR
 * 4.2 of #423).
 *
 * ## What it returns, and what it will not
 *
 * The tenant's name, the inviter's name, and the expiry. **Never the email
 * address.** Whoever legitimately holds this link read the address in their own
 * mailbox; whoever holds a stolen one did not, and this endpoint is not going
 * to tell them.
 *
 * ## 404, not 410
 *
 * Unknown, revoked, already-accepted, expired, and belonging-to-another-tenant
 * all answer identically. `410 Gone` would tell a token holder that the token
 * was once VALID — an oracle worth having if you are working through addresses
 * you scraped. The reason is recorded in the audit row, which is tenant-scoped
 * and RLS-protected, and never in the response.
 *
 * This differs from `POST /auth/password/reset`, which answers
 * `400 PASSWORD_RESET_INVALID` for the equivalent set. Both are right for their
 * shape: a reset token arrives in the BODY of a POST, where 404 would mean "no
 * such route", while an invitation token arrives in the PATH, where 404 is the
 * same answer a mistyped URL gets.
 *
 * Not routed through `defineTenantRoute` — there is no session to authorize.
 */
const GENERIC_INVALID_MESSAGE =
  "This invitation link is invalid or has expired.";

export const GET: APIRoute = async ({ request, params, clientAddress }) => {
  const tenantId = request.headers.get("x-awcms-tenant-id");
  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const token = params.token;
  if (!token) {
    return fail(404, "RESOURCE_NOT_FOUND", GENERIC_INVALID_MESSAGE);
  }

  // Before any database work. `checkAuthRateLimit` checks the SOURCE ceiling
  // first (`auth-source:${clientIp}`, a key the caller cannot choose) and only
  // then the per-tenant bucket — the #447 fix, without which a rotated tenant
  // header buys a fresh bucket every request.
  const clientIp = resolveClientIp(request, clientAddress);
  const limits = resolveInvitationRateLimit();
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "invitation-preview",
    config: limits
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

  const sql = getDatabaseClient();

  return withPublicAuthTenant(
    sql,
    tenantId,
    { workClass: "interactive" },
    async (tx) => {
      const now = new Date();
      const result = await previewInvitation(tx, tenantId, token, now);

      if (result.outcome === "invalid") {
        await recordAuditEvent(tx, {
          tenantId,
          moduleKey: "identity_access",
          action: "invitation_preview_failed",
          resourceType: "invitation",
          severity: "info",
          message: "An invitation link was previewed and refused.",
          attributes: {
            reason: result.reason,
            ipHash: hashClientIp(clientIp),
            userAgent: summarizeUserAgent(request)
          }
        });

        // Returned from INSIDE the transaction, which COMMITS — deliberately.
        // The audit row above is the record of a refused preview and must
        // survive; nothing else was mutated on this path.
        return fail(404, "RESOURCE_NOT_FOUND", GENERIC_INVALID_MESSAGE);
      }

      return ok(result.preview);
    }
  );
};
