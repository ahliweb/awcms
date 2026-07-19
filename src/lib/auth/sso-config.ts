/**
 * Tenant OIDC/SSO config gate (Issue #185, epic ERP-readiness enterprise auth
 * #177). Ported/adapted from awcms-mini `src/lib/auth/sso-config.ts`
 * (Issue #591).
 *
 * ADAPTATION vs mini: mini gates SSO behind a "full-online security" flag
 * (`isFullOnlineSecurityActive`, #587) AND `AUTH_SSO_ENABLED`. This base has NO
 * full-online gate (that epic is not ported), so the feature switch is
 * `AUTH_SSO_ENABLED` alone (same adaptation MFA's `isMfaFeatureEnabled` made,
 * sql/024/#184). Per-provider issuer/client id/secret/scopes/allowed domains are
 * tenant-configured DATA (`awcms_auth_providers`, sql/025), never env vars —
 * this file owns only the deployment-level knobs: the master enable flag, the
 * at-rest credential encryption key, and the discovery/JWKS fetch bounds.
 */

/**
 * The single feature switch every SSO login/callback/link/unlink endpoint
 * checks. When `false` (the default), those endpoints refuse with
 * `403 SSO_DISABLED` and no OIDC discovery/JWKS/token call is ever made. Admin
 * provider/policy CRUD is deliberately NOT gated by this (an admin may
 * provision a provider ahead of flipping the deployment flag).
 */
export function isSsoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_SSO_ENABLED === "true";
}

/**
 * Env vars required only when `AUTH_SSO_ENABLED=true`
 * (`scripts/validate-env.ts`). Only the credential encryption key is
 * deployment-level required — per-provider issuer/client id/secret are
 * tenant-configured DATA, validated at provider-create/OAuth-call time.
 */
export const SSO_REQUIRED_WHEN_ENABLED = [
  "AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY"
] as const;

const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000;

/**
 * Bounded timeout for OIDC discovery (`.well-known/openid-configuration`),
 * JWKS, and token-exchange fetches. Falls back to 5000ms for an unset or
 * non-numeric value — never throws, never blocks indefinitely.
 */
export function resolveSsoDiscoveryTimeoutMs(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_SSO_DISCOVERY_TIMEOUT_MS);

  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DISCOVERY_TIMEOUT_MS;
}

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

/**
 * Hard cap on the size of a discovery/JWKS/token response the SSRF guard will
 * buffer — a hostile endpoint cannot exhaust memory by streaming an unbounded
 * body. Falls back to 256 KiB (a real OIDC discovery doc/JWKS is a few KiB).
 */
export function resolveSsoMaxResponseBytes(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_SSO_MAX_RESPONSE_BYTES);

  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_RESPONSE_BYTES;
}

const DEFAULT_MAX_PROVIDERS_PER_TENANT = 20;

/**
 * Caps how many active (non-deleted) `awcms_auth_providers` rows a tenant may
 * hold. Each provider gets its own `${tenantId}:${providerKey}`-scoped
 * circuit-breaker/negative-cache budget in `generic-oidc-client.ts`; without a
 * cap a compromised tenant admin could register unbounded providers to multiply
 * internal-network probing volume. Falls back to 20.
 */
export function resolveSsoMaxProvidersPerTenant(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_SSO_MAX_PROVIDERS_PER_TENANT);

  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_PROVIDERS_PER_TENANT;
}

const DEFAULT_OAUTH_REQUEST_TTL_SEC = 600;

/** How long an in-flight OAuth request row stays valid before the callback must arrive (single-use, short-lived). Falls back to 10 minutes. */
export function resolveSsoOAuthRequestTtlSec(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = Number(env.AUTH_SSO_OAUTH_REQUEST_TTL_SEC);

  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_OAUTH_REQUEST_TTL_SEC;
}

const DEFAULT_REDIRECT_PATH_PREFIX = "/api/v1/auth/sso";

/**
 * This deployment's own callback redirect URI for a provider key — always this
 * deployment's own path under `APP_URL`, never client-supplied (the redirect
 * URI the IdP is configured to accept). Strict-matches what
 * `/api/v1/auth/sso/{providerKey}/callback` resolves to.
 */
export function resolveSsoRedirectUri(
  providerKey: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const appUrl = env.APP_URL ?? "http://localhost:4321";

  return new URL(
    `${DEFAULT_REDIRECT_PATH_PREFIX}/${providerKey}/callback`,
    appUrl
  ).toString();
}
