/**
 * Tenant OIDC SSO application orchestration (Issue #185, epic ERP-readiness
 * enterprise auth #177). Ported/adapted from awcms-mini
 * `application/tenant-sso.ts` (Issue #591), generalized and hardened:
 *   - Authorization Code + PKCE (`code_verifier` stored server-side at `start`,
 *     `code_challenge` S256 sent to the IdP, verifier replayed only to the
 *     token endpoint).
 *   - External identity keyed by `(tenant_id, provider_id, issuer, subject)`
 *     (`awcms_external_identities`, sql/025) — never email.
 *   - ID-token verification supports RS256/ES256 via a strict algorithm
 *     allow-list (`jwt-verify.ts`), with issuer/audience/expiry/nonce/azp
 *     claim validation (`oidc-policy.ts`).
 *   - MFA gate mirrors `login.ts` (#184): the callback ALWAYS looks up an
 *     active factor (fail-closed, DB-state driven) and issues an MFA challenge
 *     when one exists, so the existing `/auth/mfa/totp/verify` route completes
 *     to an aal2 session.
 *   - Optional JIT provisioning (default off) creates a new identity at the
 *     LOWEST privilege (no roles) only for a verified, allow-listed email.
 *
 * External HTTP calls (discovery/JWKS/token) happen OUTSIDE any DB transaction
 * (ADR-0006). `completeTenantSsoCallback` spans several short transactions with
 * network calls in between, never one long transaction around a provider call.
 */
import {
  findJwk,
  isAllowedJwtAlgorithm,
  parseJwt,
  verifyJwtSignature
} from "../../../lib/auth/jwt-verify";
import {
  discoverOidcConfiguration,
  exchangeAuthorizationCode,
  fetchProviderJwks
} from "../../../lib/auth/generic-oidc-client";
import { resolveSsoRedirectUri } from "../../../lib/auth/sso-config";
import {
  decryptSsoClientSecret,
  resolveSsoEncryptionKey
} from "../../../lib/auth/sso-credential-crypto";
import {
  buildOAuthStateParam,
  computePkceChallengeS256,
  generateOAuthState,
  generateOidcNonce,
  generatePkceVerifier,
  hashOAuthState,
  parseOAuthStateParam
} from "../../../lib/auth/oauth-state-token";
import { generateSessionToken } from "../../../lib/auth/session-token";
import {
  evaluateOAuthRequest,
  isEmailDomainAllowed,
  validateIdTokenClaims,
  type IdTokenClaims,
  type OAuthRequestDenyReason
} from "../domain/oidc-policy";
import { isAutoLinkAllowedForProvider } from "../domain/tenant-sso-policy";
import { withTenant } from "../../../lib/database/tenant-context";
import { resolveChallengeTtlSec } from "../../../lib/auth/mfa-config";
import { createMfaChallenge, findActiveMfaFactor } from "./mfa";
import {
  fetchAuthProviderRowByKey,
  type AuthProviderRow
} from "./auth-provider-directory";
import { getTenantAuthPolicy } from "./tenant-auth-policy";
import { hashPassword } from "../../../lib/auth/password";

export type SsoOAuthPurpose = "login" | "link";

export async function createSsoOAuthRequest(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    providerId: string;
    purpose: SsoOAuthPurpose;
    identityId: string | null;
    redirectAfter: string | null;
    ttlSec: number;
    now: Date;
  }
): Promise<{ state: string; nonce: string; codeVerifier: string }> {
  const state = generateOAuthState();
  const stateHash = hashOAuthState(state);
  const nonce = generateOidcNonce();
  const codeVerifier = generatePkceVerifier();
  const expiresAt = new Date(input.now.getTime() + input.ttlSec * 1000);

  await tx`
    INSERT INTO awcms_oidc_auth_requests
      (tenant_id, provider_id, state_hash, nonce, code_verifier, purpose,
       identity_id, redirect_after, expires_at)
    VALUES (
      ${input.tenantId}, ${input.providerId}, ${stateHash}, ${nonce},
      ${codeVerifier}, ${input.purpose}, ${input.identityId},
      ${input.redirectAfter}, ${expiresAt}
    )
  `;

  return { state, nonce, codeVerifier };
}

export type ConsumeSsoOAuthRequestResult =
  | {
      ok: true;
      purpose: SsoOAuthPurpose;
      identityId: string | null;
      nonce: string;
      codeVerifier: string;
      redirectAfter: string | null;
    }
  | { ok: false; reason: OAuthRequestDenyReason };

/** `SELECT ... FOR UPDATE` + compare-and-swap single-use consumption (concurrency-safe: two callbacks racing on the same `state` can never both win). */
export async function consumeSsoOAuthRequest(
  tx: Bun.SQL,
  tenantId: string,
  providerId: string,
  rawState: string,
  now: Date
): Promise<ConsumeSsoOAuthRequestResult> {
  const stateHash = hashOAuthState(rawState);

  const rows = (await tx`
    SELECT id, purpose, identity_id, nonce, code_verifier, redirect_after,
           expires_at, consumed_at
    FROM awcms_oidc_auth_requests
    WHERE tenant_id = ${tenantId} AND provider_id = ${providerId}
      AND state_hash = ${stateHash}
    FOR UPDATE
  `) as {
    id: string;
    purpose: SsoOAuthPurpose;
    identity_id: string | null;
    nonce: string;
    code_verifier: string;
    redirect_after: string | null;
    expires_at: Date;
    consumed_at: Date | null;
  }[];
  const row = rows[0];

  const evaluation = evaluateOAuthRequest(
    row
      ? { expiresAt: new Date(row.expires_at), consumedAt: row.consumed_at }
      : null,
    now
  );

  if (evaluation.outcome === "invalid") {
    return { ok: false, reason: evaluation.reason };
  }

  const consumedRows = (await tx`
    UPDATE awcms_oidc_auth_requests
    SET consumed_at = ${now}
    WHERE id = ${row!.id} AND consumed_at IS NULL
    RETURNING id
  `) as { id: string }[];

  if (consumedRows.length === 0) {
    return { ok: false, reason: "already_used" };
  }

  return {
    ok: true,
    purpose: row!.purpose,
    identityId: row!.identity_id,
    nonce: row!.nonce,
    codeVerifier: row!.code_verifier,
    redirectAfter: row!.redirect_after
  };
}

/** Resolves a provider's client secret in plaintext, in memory only, for the token-exchange call this request makes — never persisted, logged, or returned. `null` means misconfigured. */
export function resolveProviderClientSecret(
  provider: AuthProviderRow,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (provider.client_secret_env_var) {
    const value = env[provider.client_secret_env_var];
    return value && value.length > 0 ? value : null;
  }

  if (provider.client_secret_ciphertext) {
    const key = resolveSsoEncryptionKey(env);

    if (!key) {
      return null;
    }

    try {
      return decryptSsoClientSecret(provider.client_secret_ciphertext, key);
    } catch {
      return null;
    }
  }

  return null;
}

export type BuildAuthorizationUrlResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; code: "SSO_PROVIDER_UNAVAILABLE" };

/** Discovers `authorization_endpoint` and builds the full redirect URL, adding the PKCE `code_challenge` (S256). */
export async function buildSsoAuthorizationUrl(
  provider: AuthProviderRow,
  tenantId: string,
  state: string,
  nonce: string,
  codeVerifier: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<BuildAuthorizationUrlResult> {
  const discovery = await discoverOidcConfiguration(
    tenantId,
    provider.provider_key,
    provider.issuer_url,
    env
  );

  if (!discovery.ok) {
    return { ok: false, code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  const url = new URL(discovery.document.authorization_endpoint);
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set(
    "redirect_uri",
    resolveSsoRedirectUri(provider.provider_key, env)
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes);
  url.searchParams.set("state", buildOAuthStateParam(tenantId, state));
  url.searchParams.set("nonce", nonce);
  url.searchParams.set(
    "code_challenge",
    computePkceChallengeS256(codeVerifier)
  );
  url.searchParams.set("code_challenge_method", "S256");

  return { ok: true, authorizationUrl: url.toString() };
}

export type VerifyIdTokenResult =
  | {
      ok: true;
      issuer: string;
      subject: string;
      email: string | null;
      emailVerified: boolean;
    }
  | { ok: false; code: "SSO_ID_TOKEN_INVALID" | "SSO_PROVIDER_UNAVAILABLE" };

/** Full ID-token verification: discovery -> JWT framing -> algorithm allow-list -> JWKS -> signature (RS256/ES256 via WebCrypto) -> issuer/audience/expiry/nonce/azp claims. */
export async function verifyTenantOidcIdToken(
  tenantId: string,
  provider: AuthProviderRow,
  idToken: string,
  expectedNonce: string,
  nowSec: number,
  env: NodeJS.ProcessEnv = process.env
): Promise<VerifyIdTokenResult> {
  const discovery = await discoverOidcConfiguration(
    tenantId,
    provider.provider_key,
    provider.issuer_url,
    env
  );

  if (!discovery.ok) {
    return { ok: false, code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  let parsed;

  try {
    parsed = parseJwt(idToken);
  } catch {
    return { ok: false, code: "SSO_ID_TOKEN_INVALID" };
  }

  if (!isAllowedJwtAlgorithm(parsed.header.alg)) {
    return { ok: false, code: "SSO_ID_TOKEN_INVALID" };
  }

  const jwksResult = await fetchProviderJwks(
    tenantId,
    provider.provider_key,
    discovery.document.jwks_uri,
    env
  );

  if (!jwksResult.ok) {
    return { ok: false, code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  const jwk = findJwk(jwksResult.jwks as { keys: never[] }, parsed.header.kid);

  if (!jwk) {
    return { ok: false, code: "SSO_ID_TOKEN_INVALID" };
  }

  const signatureValid = await verifyJwtSignature(
    parsed.signingInput,
    parsed.signature,
    jwk,
    parsed.header.alg
  );

  if (!signatureValid) {
    return { ok: false, code: "SSO_ID_TOKEN_INVALID" };
  }

  const claimsValidation = validateIdTokenClaims(
    parsed.payload as IdTokenClaims,
    {
      expectedIssuer: discovery.document.issuer,
      expectedAudience: provider.client_id,
      expectedNonce,
      nowSec
    }
  );

  if (claimsValidation.outcome === "invalid") {
    return { ok: false, code: "SSO_ID_TOKEN_INVALID" };
  }

  const email =
    typeof parsed.payload.email === "string" ? parsed.payload.email : null;
  const emailVerified = parsed.payload.email_verified === true;

  return {
    ok: true,
    issuer: claimsValidation.issuer,
    subject: claimsValidation.subject,
    email,
    emailVerified
  };
}

export async function findIdentityByExternalIdentity(
  tx: Bun.SQL,
  tenantId: string,
  providerId: string,
  issuer: string,
  subject: string
): Promise<string | null> {
  const rows = (await tx`
    SELECT identity_id FROM awcms_external_identities
    WHERE tenant_id = ${tenantId} AND provider_id = ${providerId}
      AND issuer = ${issuer} AND subject = ${subject}
  `) as { identity_id: string }[];

  return rows[0]?.identity_id ?? null;
}

export type AutoLinkResult = { ok: true; identityId: string } | { ok: false };

/** Auto-link-by-email for an EXISTING local identity (never JIT here). Both fail-closed layers in `isAutoLinkAllowedForProvider` must agree, and the target identity/tenant-user must be active. */
export async function autoLinkByEmailForProvider(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    providerId: string;
    provider: AuthProviderRow;
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
    now: Date;
  }
): Promise<AutoLinkResult> {
  const policy = await getTenantAuthPolicy(tx, input.tenantId);
  const providerAllowedDomains = Array.isArray(
    input.provider.allowed_email_domains
  )
    ? (input.provider.allowed_email_domains as string[])
    : [];
  const atIndex = input.email.lastIndexOf("@");
  const domain =
    atIndex === -1 ? null : input.email.slice(atIndex + 1).toLowerCase();
  const isProviderDomainAllowed =
    domain !== null && providerAllowedDomains.includes(domain);

  const allowed = isAutoLinkAllowedForProvider(
    policy.autoLinkVerifiedEmail,
    input.emailVerified,
    isProviderDomainAllowed,
    policy.allowedEmailDomains,
    domain
  );

  if (!allowed) {
    return { ok: false };
  }

  const identityRows = (await tx`
    SELECT id, status FROM awcms_identities
    WHERE tenant_id = ${input.tenantId} AND login_identifier = ${input.email}
  `) as { id: string; status: string }[];
  const identity = identityRows[0];

  if (!identity || identity.status !== "active") {
    return { ok: false };
  }

  const tenantUserRows = (await tx`
    SELECT status FROM awcms_tenant_users
    WHERE tenant_id = ${input.tenantId} AND identity_id = ${identity.id}
  `) as { status: string }[];

  if (tenantUserRows[0]?.status !== "active") {
    return { ok: false };
  }

  await tx`
    INSERT INTO awcms_external_identities
      (tenant_id, provider_id, identity_id, issuer, subject, linked_at)
    VALUES (${input.tenantId}, ${input.providerId}, ${identity.id},
            ${input.issuer}, ${input.subject}, ${input.now})
  `;

  return { ok: true, identityId: identity.id };
}

export type JitProvisionResult =
  { ok: true; identityId: string } | { ok: false };

/**
 * Optional JIT provisioning (default off) — creates a NEW identity at the
 * LOWEST privilege (no roles assigned; authorization is default-deny until an
 * admin grants a role). Only for a VERIFIED email in an allow-listed domain and
 * only when no local identity already owns that login_identifier (a collision
 * falls through to "not linked", never a silent takeover). The identity is
 * SSO-only: `password_hash` is a fresh random argon2id hash of an unguessable
 * value, so it can never complete a local password login.
 */
export async function jitProvisionIdentity(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    providerId: string;
    provider: AuthProviderRow;
    issuer: string;
    subject: string;
    email: string;
    emailVerified: boolean;
    now: Date;
  }
): Promise<JitProvisionResult> {
  const policy = await getTenantAuthPolicy(tx, input.tenantId);

  if (!policy.jitProvisioningEnabled) {
    return { ok: false };
  }

  const providerAllowedDomains = Array.isArray(
    input.provider.allowed_email_domains
  )
    ? (input.provider.allowed_email_domains as string[])
    : [];

  if (
    !input.emailVerified ||
    !isEmailDomainAllowed(input.email, providerAllowedDomains)
  ) {
    return { ok: false };
  }

  // Tenant-policy domain list (if any) is an additional required layer.
  if (
    policy.allowedEmailDomains.length > 0 &&
    !isEmailDomainAllowed(input.email, policy.allowedEmailDomains)
  ) {
    return { ok: false };
  }

  // A collision with an existing local identity must NOT be JIT-created — the
  // user must explicitly link (or auto-link) instead.
  const existing = (await tx`
    SELECT id FROM awcms_identities
    WHERE tenant_id = ${input.tenantId} AND login_identifier = ${input.email}
  `) as { id: string }[];

  if (existing.length > 0) {
    return { ok: false };
  }

  const profileRows = (await tx`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name, verification_status)
    VALUES (${input.tenantId}, 'person', ${input.email}, 'verified')
    RETURNING id
  `) as { id: string }[];

  const unusablePassword = await hashPassword(generateSessionToken());

  const identityRows = (await tx`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${input.tenantId}, ${profileRows[0]!.id}, ${input.email}, ${unusablePassword}, 'active')
    RETURNING id
  `) as { id: string }[];
  const identityId = identityRows[0]!.id;

  await tx`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
    VALUES (${input.tenantId}, ${identityId}, 'active')
  `;

  await tx`
    INSERT INTO awcms_external_identities
      (tenant_id, provider_id, identity_id, issuer, subject, linked_at)
    VALUES (${input.tenantId}, ${input.providerId}, ${identityId},
            ${input.issuer}, ${input.subject}, ${input.now})
  `;

  return { ok: true, identityId };
}

export type LinkProviderAccountResult =
  { ok: true } | { ok: false; code: "SSO_ALREADY_LINKED" };

/** Explicit account linking for an authenticated identity — refuses if this identity (or this subject) already has a link for the provider. */
export async function linkProviderAccount(
  tx: Bun.SQL,
  input: {
    tenantId: string;
    providerId: string;
    identityId: string;
    issuer: string;
    subject: string;
    now: Date;
  }
): Promise<LinkProviderAccountResult> {
  const existingRows = (await tx`
    SELECT identity_id FROM awcms_external_identities
    WHERE tenant_id = ${input.tenantId} AND provider_id = ${input.providerId}
      AND (identity_id = ${input.identityId}
           OR (issuer = ${input.issuer} AND subject = ${input.subject}))
  `) as { identity_id: string }[];

  if (existingRows.length > 0) {
    return { ok: false, code: "SSO_ALREADY_LINKED" };
  }

  await tx`
    INSERT INTO awcms_external_identities
      (tenant_id, provider_id, identity_id, issuer, subject, linked_at)
    VALUES (${input.tenantId}, ${input.providerId}, ${input.identityId},
            ${input.issuer}, ${input.subject}, ${input.now})
  `;

  return { ok: true };
}

export type UnlinkProviderAccountResult =
  { ok: true } | { ok: false; code: "SSO_NOT_LINKED" };

export async function unlinkProviderAccount(
  tx: Bun.SQL,
  tenantId: string,
  providerId: string,
  identityId: string
): Promise<UnlinkProviderAccountResult> {
  const deletedRows = (await tx`
    DELETE FROM awcms_external_identities
    WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
      AND provider_id = ${providerId}
    RETURNING id
  `) as { id: string }[];

  if (deletedRows.length === 0) {
    return { ok: false, code: "SSO_NOT_LINKED" };
  }

  return { ok: true };
}

export type SsoOAuthErrorCode =
  | "SSO_OAUTH_STATE_INVALID"
  | "SSO_TOKEN_EXCHANGE_FAILED"
  | "SSO_ID_TOKEN_INVALID"
  | "SSO_ACCOUNT_NOT_LINKED"
  | "SSO_ALREADY_LINKED"
  | "SSO_PROVIDER_DISABLED"
  | "SSO_PROVIDER_UNAVAILABLE"
  | "ACCESS_DENIED";

export type CompleteSsoOAuthResult =
  | {
      outcome: "session_ready";
      tenantId: string;
      identityId: string;
      provisioned: boolean;
      redirectAfter: string | null;
    }
  | {
      outcome: "mfa_required";
      tenantId: string;
      identityId: string;
      challengeToken: string;
      challengeExpiresAt: Date;
    }
  | { outcome: "linked"; tenantId: string; identityId: string }
  | { outcome: "error"; code: SsoOAuthErrorCode };

/**
 * The single orchestrator `callback.ts` calls — spans multiple short
 * transactions with external HTTP calls in between, never one long transaction
 * around a provider call (ADR-0006). Re-checks `provider.enabled` here (not just
 * at `start`) — an admin may disable the provider mid-flight.
 */
export async function completeTenantSsoCallback(
  sql: Bun.SQL,
  providerKey: string,
  rawStateParam: string,
  code: string | null,
  env: NodeJS.ProcessEnv,
  now: Date
): Promise<CompleteSsoOAuthResult> {
  const parsedState = parseOAuthStateParam(rawStateParam);

  if (!parsedState) {
    return { outcome: "error", code: "SSO_OAUTH_STATE_INVALID" };
  }

  const { tenantId, token } = parsedState;

  // Resolve the provider first (need its id to look up the state row keyed by
  // provider_id, and to re-check enabled).
  const provider = await withTenant(sql, tenantId, (tx) =>
    fetchAuthProviderRowByKey(tx, tenantId, providerKey)
  );

  if (provider instanceof Response || !provider) {
    return { outcome: "error", code: "SSO_PROVIDER_DISABLED" };
  }

  const providerId = provider.id;

  const consumeResult = await withTenant(sql, tenantId, (tx) =>
    consumeSsoOAuthRequest(tx, tenantId, providerId, token, now)
  );

  if (consumeResult instanceof Response || !consumeResult.ok) {
    return { outcome: "error", code: "SSO_OAUTH_STATE_INVALID" };
  }

  if (!code) {
    return { outcome: "error", code: "SSO_OAUTH_STATE_INVALID" };
  }

  if (!provider.enabled) {
    return { outcome: "error", code: "SSO_PROVIDER_DISABLED" };
  }

  const clientSecret = resolveProviderClientSecret(provider, env);

  if (!clientSecret) {
    return { outcome: "error", code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  const discovery = await discoverOidcConfiguration(
    tenantId,
    providerKey,
    provider.issuer_url,
    env
  );

  if (!discovery.ok) {
    return { outcome: "error", code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  const exchangeResult = await exchangeAuthorizationCode({
    tenantId,
    providerKey,
    tokenEndpoint: discovery.document.token_endpoint,
    code,
    codeVerifier: consumeResult.codeVerifier,
    clientId: provider.client_id,
    clientSecret,
    redirectUri: resolveSsoRedirectUri(providerKey, env),
    env
  });

  if (!exchangeResult.ok) {
    return { outcome: "error", code: "SSO_TOKEN_EXCHANGE_FAILED" };
  }

  const verifyResult = await verifyTenantOidcIdToken(
    tenantId,
    provider,
    exchangeResult.idToken,
    consumeResult.nonce,
    Math.floor(now.getTime() / 1000),
    env
  );

  if (!verifyResult.ok) {
    return { outcome: "error", code: verifyResult.code };
  }

  const finalResult = await withTenant(sql, tenantId, async (tx) => {
    if (consumeResult.purpose === "link") {
      const linkIdentityId = consumeResult.identityId;

      if (!linkIdentityId) {
        return {
          outcome: "error" as const,
          code: "SSO_OAUTH_STATE_INVALID" as const
        };
      }

      const linkResult = await linkProviderAccount(tx, {
        tenantId,
        providerId,
        identityId: linkIdentityId,
        issuer: verifyResult.issuer,
        subject: verifyResult.subject,
        now
      });

      if (!linkResult.ok) {
        return { outcome: "error" as const, code: linkResult.code };
      }

      return {
        outcome: "linked" as const,
        tenantId,
        identityId: linkIdentityId
      };
    }

    let identityId = await findIdentityByExternalIdentity(
      tx,
      tenantId,
      providerId,
      verifyResult.issuer,
      verifyResult.subject
    );
    let provisioned = false;

    if (!identityId) {
      const autoLink = await autoLinkByEmailForProvider(tx, {
        tenantId,
        providerId,
        provider,
        issuer: verifyResult.issuer,
        subject: verifyResult.subject,
        email: verifyResult.email ?? "",
        emailVerified: verifyResult.emailVerified,
        now
      });

      if (autoLink.ok) {
        identityId = autoLink.identityId;
      } else {
        const jit = await jitProvisionIdentity(tx, {
          tenantId,
          providerId,
          provider,
          issuer: verifyResult.issuer,
          subject: verifyResult.subject,
          email: verifyResult.email ?? "",
          emailVerified: verifyResult.emailVerified,
          now
        });

        if (!jit.ok) {
          return {
            outcome: "error" as const,
            code: "SSO_ACCOUNT_NOT_LINKED" as const
          };
        }

        identityId = jit.identityId;
        provisioned = true;
      }
    }

    const identityRows = (await tx`
      SELECT status FROM awcms_identities WHERE id = ${identityId}
    `) as { status: string }[];
    const tenantUserRows = (await tx`
      SELECT status FROM awcms_tenant_users
      WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
    `) as { status: string }[];

    if (
      identityRows[0]?.status !== "active" ||
      tenantUserRows[0]?.status !== "active"
    ) {
      return { outcome: "error" as const, code: "ACCESS_DENIED" as const };
    }

    // MFA gate — fail-closed, DB-state driven (mirrors login.ts #184): if an
    // active factor exists, issue a login challenge and let the existing
    // `/auth/mfa/totp/verify` route complete to an aal2 session.
    const factor = await findActiveMfaFactor(tx, tenantId, identityId);

    if (factor) {
      const challenge = await createMfaChallenge(
        tx,
        tenantId,
        identityId,
        resolveChallengeTtlSec(env),
        now
      );

      return {
        outcome: "mfa_required" as const,
        tenantId,
        identityId,
        challengeToken: challenge.token,
        challengeExpiresAt: challenge.expiresAt
      };
    }

    return {
      outcome: "session_ready" as const,
      tenantId,
      identityId,
      provisioned,
      redirectAfter: consumeResult.redirectAfter
    };
  });

  if (finalResult instanceof Response) {
    return { outcome: "error", code: "SSO_PROVIDER_UNAVAILABLE" };
  }

  return finalResult;
}
