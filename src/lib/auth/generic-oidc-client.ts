/**
 * Generic tenant OIDC provider network calls (Issue #185, epic ERP-readiness
 * enterprise auth #177) — `.well-known/openid-configuration` discovery, JWKS
 * fetch, and Authorization-Code + PKCE token exchange against a
 * TENANT-CONFIGURED issuer. Ported/adapted from awcms-mini
 * `src/lib/auth/generic-oidc-client.ts` (Issues #591/#610).
 *
 * ADAPTATIONS vs mini:
 *   - EVERY outbound call goes through `ssrf-guard.ts`'s `ssrfSafeFetch`
 *     (HTTPS-only, private/loopback/link-local/metadata IP block, manual
 *     re-validated redirects, bounded timeout, response-size cap). mini
 *     deliberately did NOT IP-range-block; issue #185 makes that the top
 *     requirement — so a discovery doc whose `jwks_uri`/`token_endpoint` points
 *     at an internal address is blocked at fetch time, not just at config time.
 *   - Discovery asserts the returned `issuer` EXACTLY equals the configured
 *     issuer URL (OIDC Discovery §4.3) — a compromised discovery endpoint
 *     cannot claim a different issuer than the one an admin configured and that
 *     ID-token validation will check against.
 *   - PKCE `code_verifier` is sent on token exchange.
 *
 * Circuit breaker + negative-TTL caches are keyed by `${tenantId}:${providerKey}`
 * (NEVER `providerKey` alone — `provider_key` is unique only per tenant, so
 * keying by it alone would let one tenant's `"okta"` discovery/breaker state be
 * served to another tenant's identically-named provider: a cross-tenant
 * takeover primitive). The breaker only trips on a genuine transport-level
 * failure or an SSRF-policy denial, NEVER on a well-formed error response driven
 * by attacker-controlled input (a bad/reused `code` answered `400 invalid_grant`
 * is the provider correctly rejecting a bad request, not being unhealthy) — so
 * it can never block a legitimate login to a healthy provider.
 */
import { getProviderCircuitBreaker } from "../database/circuit-breaker";
import { ssrfSafeFetch } from "./ssrf-guard";
import {
  resolveSsoDiscoveryTimeoutMs,
  resolveSsoMaxResponseBytes
} from "./sso-config";

export type OidcDiscoveryDocument = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export type DiscoverOidcResult =
  { ok: true; document: OidcDiscoveryDocument } | { ok: false };

const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Short negative-TTL for a FAILED discovery/JWKS attempt — the positive caches
 * only ever fill on success, so without this a target that never returns a
 * valid document would get a fresh live network attempt on every unauthenticated
 * `/start` hit. This makes repeated hits within the window return the cached
 * failure instantly, removing most of the liveness/timing signal an
 * internal-network prober could read. Much shorter than the positive TTL so a
 * provider recovering from a transient outage starts working again quickly.
 */
const NEGATIVE_CACHE_TTL_MS = 30 * 1000;

const discoveryCache = new Map<
  string,
  { document: OidcDiscoveryDocument; fetchedAt: number }
>();
const discoveryFailureCache = new Map<string, number>();
const jwksCache = new Map<string, { jwks: GenericJwks; fetchedAt: number }>();
const jwksFailureCache = new Map<string, number>();

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
}

/** `provider_key` is only unique PER TENANT — this is the ONE cache/breaker key builder every function below must use. */
function scopedKey(tenantId: string, providerKey: string): string {
  return `${tenantId}:${providerKey}`;
}

/**
 * Fetches (and caches for `DISCOVERY_CACHE_TTL_MS`) a tenant-configured
 * provider's `.well-known/openid-configuration`, via the SSRF guard, asserting
 * the returned `issuer` matches the configured one.
 */
export async function discoverOidcConfiguration(
  tenantId: string,
  providerKey: string,
  issuerUrl: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<DiscoverOidcResult> {
  const key = scopedKey(tenantId, providerKey);
  const normalizedIssuer = normalizeIssuer(issuerUrl);
  const now = Date.now();
  const cached = discoveryCache.get(key);

  if (cached && now - cached.fetchedAt < DISCOVERY_CACHE_TTL_MS) {
    return { ok: true, document: cached.document };
  }

  const recentFailure = discoveryFailureCache.get(key);

  if (
    recentFailure !== undefined &&
    now - recentFailure < NEGATIVE_CACHE_TTL_MS
  ) {
    return { ok: false };
  }

  const breaker = getProviderCircuitBreaker(`sso-oidc-discovery:${key}`);
  const attemptedAt = new Date();

  if (!breaker.canAttempt(attemptedAt)) {
    discoveryFailureCache.set(key, now);
    return { ok: false };
  }

  const result = await ssrfSafeFetch(
    `${normalizedIssuer}/.well-known/openid-configuration`,
    {
      timeoutMs: resolveSsoDiscoveryTimeoutMs(env),
      maxResponseBytes: resolveSsoMaxResponseBytes(env),
      env
    }
  );

  if (!result.ok) {
    breaker.recordFailure(attemptedAt);
    discoveryFailureCache.set(key, now);
    return { ok: false };
  }

  const response = result.response;

  if (response.status < 200 || response.status >= 300) {
    breaker.recordFailure(attemptedAt);
    discoveryFailureCache.set(key, now);
    return { ok: false };
  }

  const document = (await response
    .json()
    .catch(() => null)) as Partial<OidcDiscoveryDocument> | null;

  if (
    !document ||
    typeof document.issuer !== "string" ||
    typeof document.authorization_endpoint !== "string" ||
    typeof document.token_endpoint !== "string" ||
    typeof document.jwks_uri !== "string" ||
    normalizeIssuer(document.issuer) !== normalizedIssuer
  ) {
    breaker.recordFailure(attemptedAt);
    discoveryFailureCache.set(key, now);
    return { ok: false };
  }

  breaker.recordSuccess(attemptedAt);
  discoveryFailureCache.delete(key);
  const resolved = document as OidcDiscoveryDocument;
  discoveryCache.set(key, { document: resolved, fetchedAt: now });
  return { ok: true, document: resolved };
}

export type GenericJwks = { keys: Record<string, unknown>[] };

export type FetchJwksResult = { ok: true; jwks: GenericJwks } | { ok: false };

/** Same breaker/negative-cache/`${tenantId}:${providerKey}` scoping and SSRF guard as `discoverOidcConfiguration`. */
export async function fetchProviderJwks(
  tenantId: string,
  providerKey: string,
  jwksUri: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<FetchJwksResult> {
  const key = scopedKey(tenantId, providerKey);
  const now = Date.now();
  const cached = jwksCache.get(key);

  if (cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return { ok: true, jwks: cached.jwks };
  }

  const recentFailure = jwksFailureCache.get(key);

  if (
    recentFailure !== undefined &&
    now - recentFailure < NEGATIVE_CACHE_TTL_MS
  ) {
    return { ok: false };
  }

  const breaker = getProviderCircuitBreaker(`sso-oidc-jwks:${key}`);
  const attemptedAt = new Date();

  if (!breaker.canAttempt(attemptedAt)) {
    jwksFailureCache.set(key, now);
    return { ok: false };
  }

  const result = await ssrfSafeFetch(jwksUri, {
    timeoutMs: resolveSsoDiscoveryTimeoutMs(env),
    maxResponseBytes: resolveSsoMaxResponseBytes(env),
    env
  });

  if (!result.ok) {
    breaker.recordFailure(attemptedAt);
    jwksFailureCache.set(key, now);
    return { ok: false };
  }

  const response = result.response;

  if (response.status < 200 || response.status >= 300) {
    breaker.recordFailure(attemptedAt);
    jwksFailureCache.set(key, now);
    return { ok: false };
  }

  const jwks = (await response.json().catch(() => null)) as GenericJwks | null;

  if (!jwks || !Array.isArray(jwks.keys)) {
    breaker.recordFailure(attemptedAt);
    jwksFailureCache.set(key, now);
    return { ok: false };
  }

  breaker.recordSuccess(attemptedAt);
  jwksFailureCache.delete(key);
  jwksCache.set(key, { jwks, fetchedAt: now });
  return { ok: true, jwks };
}

export type ExchangeCodeParams = {
  tenantId: string;
  providerKey: string;
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  env?: NodeJS.ProcessEnv;
};

export type ExchangeCodeResult =
  { ok: true; idToken: string } | { ok: false; retryable: boolean };

/**
 * Authorization-Code + PKCE exchange against the provider's `token_endpoint`
 * (from discovery), via the SSRF guard. Breaker-tripping rule: a genuine
 * 5xx/network/timeout/SSRF-denial records failure (retryable); a well-formed
 * 4xx (bad/reused/expired `code`) records SUCCESS (the provider is healthy — it
 * just correctly rejected attacker-controlled input) and returns a
 * non-retryable failure.
 */
export async function exchangeAuthorizationCode(
  params: ExchangeCodeParams
): Promise<ExchangeCodeResult> {
  const env = params.env ?? process.env;
  const key = scopedKey(params.tenantId, params.providerKey);
  const breaker = getProviderCircuitBreaker(`sso-oidc-token:${key}`);
  const attemptedAt = new Date();

  if (!breaker.canAttempt(attemptedAt)) {
    return { ok: false, retryable: true };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.codeVerifier,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri
  });

  const result = await ssrfSafeFetch(params.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // A token endpoint must never redirect a POST — do not follow any.
    maxRedirects: 0,
    timeoutMs: resolveSsoDiscoveryTimeoutMs(env),
    maxResponseBytes: resolveSsoMaxResponseBytes(env),
    env
  });

  if (!result.ok) {
    breaker.recordFailure(attemptedAt);
    return { ok: false, retryable: true };
  }

  const response = result.response;
  const rawBody = await response.text().catch(() => "");
  let parsed: { id_token?: string } | undefined;

  try {
    parsed = rawBody
      ? (JSON.parse(rawBody) as { id_token?: string })
      : undefined;
  } catch {
    parsed = undefined;
  }

  if (response.status >= 500 || response.status === 0 || !parsed) {
    breaker.recordFailure(attemptedAt);
    return { ok: false, retryable: true };
  }

  if (response.status < 200 || response.status >= 300 || !parsed.id_token) {
    breaker.recordSuccess(attemptedAt);
    return { ok: false, retryable: false };
  }

  breaker.recordSuccess(attemptedAt);
  return { ok: true, idToken: parsed.id_token };
}

/** Test-only: clears the in-memory discovery/JWKS caches so test files don't bleed into each other. */
export function resetGenericOidcCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
  discoveryFailureCache.clear();
  jwksFailureCache.clear();
}
