import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import { withPublicAuthTenant } from "../../../../../modules/identity-access/application/public-auth-tenant";
import { recordAuditEvent } from "../../../../../modules/logging/application/audit-log";
import { resolveLoginPolicyConfig } from "../../../../../modules/identity-access/application/login-policy";
import { evaluateTenantEntry } from "../../../../../modules/identity-access/application/tenant-entry";
import { redeemPrincipalSelectionToken } from "../../../../../modules/identity-access/application/principal-store";
import {
  hashPrincipalSelectionToken,
  isPrincipalSelectionToken
} from "../../../../../lib/auth/principal-selection-token";
import { createSessionWithAssurance } from "../../../../../modules/identity-access/application/mfa-session-assurance";
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME
} from "../../../../../lib/auth/ssr-session";
import {
  persistableClientIpHash,
  summarizeUserAgent
} from "../../../../../lib/security/client-fingerprint";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../lib/security/auth-rate-limit";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { log } from "../../../../../lib/logging/logger";

type SelectTenantBody = { principalToken?: unknown; tenantId?: unknown };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `POST /api/v1/auth/session/tenant` — ADR-0088, Gelombang 7 PR 7.4 of #423.
 *
 * Spends the selection token minted by a tenantless `POST /auth/login` and
 * issues a session in the tenant the CALLER names.
 *
 * ## This is the second half of a login, not a redemption counter
 *
 * The token proves one thing — a human proved the global credential less than
 * two minutes ago — and it deliberately proves nothing about the tenant now
 * being named. So every gate `/auth/login` applies once a tenant is known is
 * applied here through `evaluateTenantEntry`: serviceability, membership,
 * the tenant's auth policy, and above all the tenant's MFA policy. Skipping the
 * last one would make tenant selection an MFA bypass into exactly the tenants
 * that decided to require it.
 *
 * ## One response for every refusal
 *
 * Unknown token, expired token, spent token, no membership, inactive identity —
 * all `401 INVALID_CREDENTIALS`. The caller supplies the tenant id, so a
 * response that distinguished "no membership" from "bad token" would answer
 * "does this person belong to that tenant?" for any tenant an attacker names.
 * That is the cross-tenant membership oracle ADR-0087 refused, reached through
 * a different door.
 *
 * Two refusals are deliberately NOT collapsed, because both are only reachable
 * once the token has already been proven genuine and spent: a suspended tenant
 * (`403 TENANT_UNAVAILABLE`) and a tenant that disables password login for this
 * identity (`403 PASSWORD_LOGIN_DISABLED`). They tell an operator why an
 * otherwise valid sign-in stopped, and they leak nothing an attacker without
 * the token could reach.
 *
 * ## Not `defineTenantRoute`
 *
 * The tenant arrives in the BODY, not the header, and the bearer is a selection
 * token rather than a session — the factory requires the opposite of both. The
 * tenant transaction is opened by `withPublicAuthTenant`, the named opening the
 * other unauthenticated auth surfaces already use.
 */
export const POST: APIRoute = async ({
  request,
  cookies,
  clientAddress,
  locals
}) => {
  const policy = resolveLoginPolicyConfig();
  const clientIp = resolveClientIp(request, clientAddress);

  const bodyRead = await readJsonBody<SelectTenantBody>(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = bodyRead.value;

  if (
    !body ||
    typeof body.principalToken !== "string" ||
    typeof body.tenantId !== "string" ||
    !UUID_PATTERN.test(body.tenantId)
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "principalToken and a uuid tenantId are required."
    );
  }

  const tenantId = body.tenantId;

  // Rate limited on the TARGET tenant's bucket: this endpoint is where a stolen
  // or guessed token would be aimed, and the tenant being entered is the party
  // whose ceiling should absorb it.
  const rateLimit = await checkAuthRateLimit({
    clientIp,
    tenantId,
    scope: "session-tenant",
    config: {
      maxAttempts: policy.rateLimitMaxAttempts,
      windowMs: policy.rateLimitWindowSec * 1000
    }
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many attempts from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  // Prefix check before any query: a bearer that is not a selection token can
  // never be looked up in the selection namespace, so a session token pasted
  // here is refused without touching the credential table.
  if (!isPrincipalSelectionToken(body.principalToken)) {
    return fail(401, "INVALID_CREDENTIALS", "Invalid credentials.");
  }

  const principalToken = body.principalToken;
  const sql = getDatabaseClient();
  const now = new Date();

  return withPublicAuthTenant(
    sql,
    tenantId,
    { workClass: "interactive" },
    async (tx) => {
      // Spent FIRST, and spent whatever happens next. A token that survived a
      // refusal would let an attacker who guessed one tenant id keep trying
      // others with the same token — turning a single-use credential into a
      // membership scanner.
      const principalId = await redeemPrincipalSelectionToken(
        tx,
        hashPrincipalSelectionToken(principalToken),
        now
      );

      if (!principalId) {
        return fail(401, "INVALID_CREDENTIALS", "Invalid credentials.");
      }

      const entry = await evaluateTenantEntry(tx, {
        tenantId,
        principalId,
        now
      });

      if (!entry.ok) {
        if (entry.kind === "tenant_unavailable") {
          return fail(
            403,
            "TENANT_UNAVAILABLE",
            "This tenant is not currently being served."
          );
        }

        if (entry.kind === "password_login_disabled") {
          return fail(
            403,
            "PASSWORD_LOGIN_DISABLED",
            "Password sign-in is disabled for this account by tenant policy. Use single sign-on."
          );
        }

        if (entry.kind === "mfa_challenge") {
          return fail(
            401,
            "MFA_REQUIRED",
            "Multi-factor authentication is required to complete sign-in.",
            {},
            {
              mfaChallengeToken: entry.token,
              expiresAt: entry.expiresAt.toISOString()
            }
          );
        }

        if (entry.kind === "mfa_enrollment") {
          return fail(
            401,
            "MFA_ENROLLMENT_REQUIRED",
            "Multi-factor authentication enrollment is required before sign-in can complete.",
            {},
            {
              mfaEnrollmentToken: entry.token,
              expiresAt: entry.expiresAt.toISOString()
            }
          );
        }

        log("info", "auth.session_tenant.no_membership", {
          moduleKey: "identity_access",
          tenantId,
          correlationId: locals.correlationId
        });

        return fail(401, "INVALID_CREDENTIALS", "Invalid credentials.");
      }

      // `origin_auth: 'password'` — honest provenance. The root of this session
      // IS a password, verified against the global credential minutes ago, and
      // that is exactly what makes it switchable later. Stamping `switch` here
      // would be wrong in the one field somebody reasoning about blast radius
      // reads.
      const created = await createSessionWithAssurance(tx, {
        tenantId,
        identityId: entry.identityId,
        assuranceLevel: "aal1",
        ttlMin: policy.sessionTtlMin,
        now,
        issue: {
          originAuth: "password",
          clientIpHash: persistableClientIpHash(clientIp),
          userAgentSummary: summarizeUserAgent(request) ?? null
        }
      });

      // The tenantless half of this login could not be audited — there was no
      // tenant to file it under. THIS is where it becomes visible, in the
      // tenant that was actually entered.
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: "identity_access",
        action: "session_tenant_selected",
        resourceType: "identity",
        resourceId: entry.identityId,
        severity: "info",
        message: "Tenant selected after a tenantless sign-in; session created.",
        attributes: { method: "selection_token" },
        correlationId: locals.correlationId
      });

      // Same cookie pair `/auth/login` sets, for the same reason: the admin UI
      // is server-rendered and reads the session from httpOnly cookies, so a
      // tenant chosen through this endpoint has to land the browser in exactly
      // the state a direct login would have.
      const cookieOptions = {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        maxAge: policy.sessionTtlMin * 60,
        secure: process.env.AUTH_COOKIE_SECURE === "true"
      };

      cookies.set(SESSION_COOKIE_NAME, created.token, cookieOptions);
      cookies.set(TENANT_COOKIE_NAME, tenantId, cookieOptions);

      return ok({
        token: created.token,
        expiresAt: created.expiresAt.toISOString(),
        tenantId
      });
    }
  );
};
