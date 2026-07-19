import type { APIRoute } from "astro";

import { fail } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { withTenant } from "../../../../../../lib/database/tenant-context";
import { TENANT_COOKIE_NAME } from "../../../../../../lib/auth/ssr-session";
import {
  checkRateLimit,
  resolveClientIp
} from "../../../../../../lib/security/rate-limit";
import {
  isSsoEnabled,
  resolveSsoOAuthRequestTtlSec
} from "../../../../../../lib/auth/sso-config";
import { sanitizeReturnTo } from "../../../../../../lib/auth/oauth-state-token";
import {
  buildSsoAuthorizationUrl,
  createSsoOAuthRequest
} from "../../../../../../modules/identity-access/application/tenant-sso";
import { fetchAuthProviderRowByKey } from "../../../../../../modules/identity-access/application/auth-provider-directory";

const RATE_LIMIT_MAX_ATTEMPTS = Number(
  process.env.AUTH_LOGIN_RATE_LIMIT_MAX ?? 20
);
const RATE_LIMIT_WINDOW_SEC = Number(
  process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC ?? 60
);

/**
 * `GET /api/v1/auth/sso/{providerKey}/start` (Issue #185) — unauthenticated
 * entry point. Resolves the tenant BEFORE the flow starts (header/cookie/
 * `?tenantId=` fallback — a plain browser navigation to a provider has no tenant
 * cookie yet) and binds it into the `state` (see `oauth-state-token.ts`), so a
 * callback can never be pointed at a different tenant. Checks tenant
 * existence/status via a plain SELECT before any INSERT (avoids a
 * shared-breaker DoS from unknown-tenant probing). Returns a generic
 * `404 SSO_PROVIDER_NOT_FOUND` once the feature is confirmed enabled but the
 * key doesn't resolve to an enabled provider — no distinct enumeration signal.
 *
 * A single per-source+tenant rate limit only (never a shared/aggregate one
 * keyed by providerKey alone — that would be a privilege-free DoS locking out
 * every legitimate user; the real anti-probing defense is
 * `generic-oidc-client.ts`'s per-`${tenantId}:${providerKey}` circuit breaker +
 * negative cache, which only ever throttle FAILING attempts).
 */
export const GET: APIRoute = async ({
  request,
  cookies,
  url,
  params,
  clientAddress
}) => {
  if (!isSsoEnabled()) {
    return fail(
      403,
      "SSO_DISABLED",
      "Tenant OIDC SSO is not enabled for this deployment."
    );
  }

  const providerKey = params.providerKey;

  if (!providerKey) {
    return fail(400, "VALIDATION_ERROR", "providerKey is required.");
  }

  const tenantId =
    request.headers.get("x-awcms-tenant-id") ??
    cookies.get(TENANT_COOKIE_NAME)?.value ??
    url.searchParams.get("tenantId") ??
    null;

  if (!tenantId) {
    return fail(400, "TENANT_REQUIRED", "Tenant header is required.");
  }

  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = checkRateLimit(`${clientIp}:${tenantId}:sso-start`, {
    maxAttempts: RATE_LIMIT_MAX_ATTEMPTS,
    windowMs: RATE_LIMIT_WINDOW_SEC * 1000
  });

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many requests from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const redirectAfter = sanitizeReturnTo(url.searchParams.get("returnTo"));
  const sql = getDatabaseClient();
  const now = new Date();

  const result = await withTenant(sql, tenantId, async (tx) => {
    const tenantRows = (await tx`
      SELECT status FROM awcms_tenants WHERE id = ${tenantId}
    `) as { status: string }[];

    if (tenantRows[0]?.status !== "active") {
      return { outcome: "denied" as const };
    }

    const provider = await fetchAuthProviderRowByKey(tx, tenantId, providerKey);

    if (!provider || !provider.enabled) {
      return { outcome: "not_found" as const };
    }

    const { state, nonce, codeVerifier } = await createSsoOAuthRequest(tx, {
      tenantId,
      providerId: provider.id,
      purpose: "login",
      identityId: null,
      redirectAfter,
      ttlSec: resolveSsoOAuthRequestTtlSec(),
      now
    });

    return { outcome: "ready" as const, provider, state, nonce, codeVerifier };
  });

  if (result instanceof Response) {
    return result;
  }

  if (result.outcome === "denied") {
    return fail(403, "ACCESS_DENIED", "Tenant is not active.");
  }

  if (result.outcome === "not_found") {
    return fail(
      404,
      "SSO_PROVIDER_NOT_FOUND",
      "No enabled SSO provider matches this key."
    );
  }

  const authorizationResult = await buildSsoAuthorizationUrl(
    result.provider,
    tenantId,
    result.state,
    result.nonce,
    result.codeVerifier
  );

  if (!authorizationResult.ok) {
    return fail(
      502,
      authorizationResult.code,
      "The SSO provider could not be reached. Try again later."
    );
  }

  return new Response(null, {
    status: 302,
    headers: { Location: authorizationResult.authorizationUrl }
  });
};
