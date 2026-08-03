import { fail, ok } from "../../../../../modules/_shared/api-response";
import { defineSelfServiceTenantRoute } from "../../../../../modules/_shared/tenant-route";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { resolveSessionAssurance } from "../../../../../modules/identity-access/application/mfa-session-assurance";
import { issueHandoffCode } from "../../../../../modules/identity-access/application/session-handoff-directory";
import { resolveTenantContext } from "../../../../../modules/identity-access/application/auth-context";
import { log } from "../../../../../lib/logging/logger";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../lib/security/rate-limit";

/**
 * `POST /api/v1/auth/session-handoff/issue` (ADR-0050) — the authenticated
 * human asks for a one-time code that lets a registered BFF obtain a session
 * as them.
 *
 * ## Why this is self-service and not permission-gated
 *
 * The caller can only ever mint a code for their OWN session: the identity and
 * assurance level come from the presented session, never from the body. There
 * is no permission that answers "may I hand my own session to a client I am
 * already logged into" — and inventing one would be the latent-authz trap this
 * repo has shipped twice, where a guard names an action no migration seeds and
 * denies everyone including the owner. Same reasoning, and same factory, as
 * `GET /api/v1/auth/session` (ADR-0049 §7).
 *
 * What constrains it is the CLIENT registry, not a permission: a code can only
 * be issued to a registered, enabled client, bound to a `redirect_uri` on that
 * client's exact-match allow-list.
 *
 * ## Why the login endpoint was not touched
 *
 * The obvious alternative — thread `handoff`/`redirect_uri` through
 * `POST /api/v1/auth/login` — would have to work across four different login
 * shapes: password, MFA continuation, OIDC callback, Turnstile-gated. Issuing
 * AFTER a session exists works identically for all four and adds nothing to the
 * most security-sensitive endpoint in the repo.
 *
 * ## No Idempotency-Key
 *
 * A retry must NOT return the first code. Each call mints a fresh single-use
 * credential; replaying one would mean two live codes for one request, which is
 * the opposite of what an idempotency record is for. The code expires in 60
 * seconds, so a lost response costs one retry.
 */
export const POST = defineSelfServiceTenantRoute({
  workClass: "interactive",
  // One shape for both, deliberately: distinguishing them tells an unauthenticated
  // caller whether the tenant header it guessed is real.
  onUnauthenticated: () =>
    fail(401, "AUTH_REQUIRED", "Authentication required."),
  // ADR-0066 — anti-automation on every authentication surface, not most.
  // Self-service from a live session; the bound stops one compromised session
  // minting handoff codes in a loop.
  beforeTransaction: async ({ request, clientAddress }) => {
    const rate = await checkSharedRateLimit(
      `handoff-issue:${resolveClientIp(request, clientAddress)}`,
      { maxAttempts: 30, windowMs: 60_000 }
    );

    return rate.allowed
      ? undefined
      : fail(429, "RATE_LIMITED", "Too many requests. Try again shortly.");
  },
  handler: async ({ tx, tenantId, tokenHash, request, locals }) => {
    const bodyRead = await readJsonBody(request);

    if (bodyRead.tooLarge) {
      return bodyTooLargeResponse(bodyRead.limitBytes);
    }

    const body = (bodyRead.value ?? {}) as Record<string, unknown>;
    const clientKey = typeof body.clientKey === "string" ? body.clientKey : "";
    const redirectUri =
      typeof body.redirectUri === "string" ? body.redirectUri : "";

    if (clientKey === "" || redirectUri === "") {
      return fail(
        400,
        "VALIDATION_ERROR",
        "clientKey and redirectUri are required."
      );
    }

    // The identity and assurance come from the SESSION, never the body. A body
    // that could name an identity would be an impersonation endpoint.
    const now = new Date();
    const assurance = await resolveSessionAssurance(
      tx,
      tenantId,
      tokenHash,
      now
    );

    if (!assurance) {
      return fail(401, "AUTH_REQUIRED", "Authentication required.");
    }

    // Resolved rather than derived: the audit row must name the tenant USER,
    // and an identity without a tenant-user row is not a caller this endpoint
    // should serve at all.
    const context = await resolveTenantContext(tx, tenantId, tokenHash, now);

    if (!context) {
      return fail(401, "AUTH_REQUIRED", "Authentication required.");
    }

    const result = await issueHandoffCode(
      tx,
      tenantId,
      {
        clientKey,
        requestedRedirectUri: redirectUri,
        identityId: assurance.identityId,
        sessionId: assurance.sessionId,
        assuranceLevel: assurance.assuranceLevel,
        actorTenantUserId: context.tenantUserId,
        now
      },
      locals.correlationId
    );

    if (!result.ok) {
      // ONE answer for every rejection. Telling an unknown client from a
      // non-allow-listed redirect_uri turns this into a probe for which clients
      // are registered and which URIs they accept — and the allow-list is the
      // single control ADR-0050 names as the way this design fails.
      log("warning", "identity-access.session_handoff.issue_rejected", {
        correlationId: locals.correlationId,
        tenantId,
        moduleKey: "identity_access",
        reason: result.reason
      });

      return fail(
        400,
        "HANDOFF_NOT_ALLOWED",
        "This client and redirect_uri combination cannot be used for a session handoff."
      );
    }

    return ok({
      code: result.code,
      redirectUri: result.redirectUri,
      expiresAt: result.expiresAt
    });
  }
});
