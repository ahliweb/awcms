import type { APIRoute } from "astro";

import { fail, ok } from "../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../lib/database/client";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../../lib/security/request-body-limit";
import { resolveAuthInputs } from "../../../../../modules/identity-access/application/access-guard";
import { hashSessionToken } from "../../../../../lib/auth/session-token";
import {
  completeRedemption,
  loadRedeemer
} from "../../../../../modules/identity-access/application/delegated-access-redemption";
import { isDelegatedAccessCode } from "../../../../../lib/auth/delegated-access-code";
import { resolveClientIp } from "../../../../../lib/security/rate-limit";
import { checkAuthRateLimit } from "../../../../../lib/security/auth-rate-limit";
import { resolveLoginPolicyConfig } from "../../../../../modules/identity-access/application/login-policy";
import { log } from "../../../../../lib/logging/logger";

/**
 * `POST /api/v1/auth/delegated-access/redeem` — ADR-0090, Gelombang 8 PR 8.4.
 *
 * A partner's person exchanges the code their customer gave them for a real
 * membership in that customer's tenant.
 *
 * ## Two tenants, two transactions
 *
 * The caller authenticates in THEIR tenant and the work lands in the CUSTOMER's,
 * so `defineTenantRoute` cannot be used — it would authorize against the wrong
 * one. The openings live in `delegated-access-redemption.ts`, the same shape
 * `session-switch.ts` took for exactly the same reason; this is the fifth
 * instance of that pattern, not a way around `api:tenant-route:check`.
 *
 * ## It returns a membership, not a session
 *
 * Ordinary login (or `POST /auth/session/switch`) works afterwards, because
 * afterwards they are a member. Minting a session here would mean re-applying
 * the target tenant's auth policy, MFA policy and serviceability — a second
 * copy of `evaluateTenantEntry`, and a second copy is where the MFA gate goes
 * quietly missing.
 *
 * ## Every failure answers the same way
 *
 * Unknown code, expired grant, revoked grant, wrong tenant, membership refused:
 * all `404`. A caller holding a code must not be able to learn whether it is
 * real, which tenant it belongs to, or whether it has already been spent —
 * anything finer turns this endpoint into an oracle for a live credential.
 */
const RATE_LIMIT_KEY = "delegated_access_redeem";

export const POST: APIRoute = async ({
  request,
  cookies,
  locals,
  clientAddress
}) => {
  const inputs = resolveAuthInputs(request, cookies);
  if (!inputs.tenantId || !inputs.token) {
    return fail(401, "AUTH_REQUIRED", "Sign in before redeeming a code.");
  }

  const bodyRead = await readJsonBody(request);
  if (bodyRead.tooLarge) return bodyTooLargeResponse(bodyRead.limitBytes);

  const body = bodyRead.value as {
    targetTenantId?: unknown;
    code?: unknown;
  } | null;

  if (
    typeof body?.targetTenantId !== "string" ||
    typeof body.code !== "string"
  ) {
    return fail(
      400,
      "VALIDATION_ERROR",
      "targetTenantId and code are required."
    );
  }

  // Shape-checked before anything is spent: a value that is not a redemption
  // code cannot be one, and answering that without a database round trip keeps
  // the rate-limit budget for real attempts.
  if (!isDelegatedAccessCode(body.code)) {
    return fail(404, "NOT_FOUND", "That code cannot be redeemed.");
  }

  const sql = getDatabaseClient();
  const now = new Date();

  // Rate-limited on the SOURCE tenant plus client IP: a code is a bearer, and
  // an endpoint that turns one into a membership is worth guessing at. The
  // SOURCE tenant is the bucket on purpose — the target is attacker-supplied,
  // so bucketing on it would let one attacker spread across every tenant id
  // they care to type.
  const policy = resolveLoginPolicyConfig();
  const rateLimit = await checkAuthRateLimit({
    clientIp: resolveClientIp(request, clientAddress),
    tenantId: inputs.tenantId,
    scope: RATE_LIMIT_KEY,
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

  const redeemer = await loadRedeemer(
    sql,
    inputs.tenantId,
    hashSessionToken(inputs.token),
    now
  );

  if (!redeemer) {
    return fail(401, "AUTH_REQUIRED", "Session is invalid or expired.");
  }

  const { outcome } = await completeRedemption(
    sql,
    body.targetTenantId,
    body.code,
    redeemer,
    now,
    locals.correlationId
  );

  if (!outcome.ok) {
    log("warning", "auth.delegated_access.redeem_refused", {
      moduleKey: "identity_access",
      tenantId: body.targetTenantId,
      reason: outcome.code,
      correlationId: locals.correlationId
    });

    return fail(404, "NOT_FOUND", "That code cannot be redeemed.");
  }

  log("info", "auth.delegated_access.redeemed", {
    moduleKey: "identity_access",
    tenantId: body.targetTenantId,
    correlationId: locals.correlationId
  });

  return ok({
    tenantId: body.targetTenantId,
    tenantUserId: outcome.tenantUserId,
    // No session, and no token. Sign in to that tenant, or switch into it.
    nextStep: "sign_in_to_tenant"
  });
};
