🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](oidc-sso.id.md)

# Tenant-aware OIDC/SSO, account linking, and break-glass

Implementation reference for Issue #185 (epic #177). Module: `identity-access`. ADR: [ADR-0028](../adr/0028-oidc-sso-tenant-aware-account-linking-break-glass.md). Schema: `sql/025_awcms_oidc_sso_schema.sql`, permission seed: `sql/026_awcms_seed_sso_permissions.sql`. Step-up/MFA integration: [MFA/step-up](mfa-totp-step-up.md).

The feature is active only when `AUTH_SSO_ENABLED=true`. Local/offline/LAN deployments that do not enable it never call an IdP and behave exactly as they did before this feature existed.

## 1. Architecture & trust boundary

- The external IdP is an **authenticator**, not an authority. Once OIDC succeeds, AWCMS mints its own **opaque session**; authorization still goes through RBAC/ABAC/RLS. The ID token is never used as the application session.
- Provider configuration is **per-tenant DATA** (`awcms_auth_providers`): issuer/discovery, client id, secret reference, scope, allowed domains, enabled. One deployment serves many tenants with different issuers/policies.
- All new tables are tenant-scoped + RLS `ENABLE`+`FORCE`.

## 2. Auth flow

### 2.1 Login

```
GET /api/v1/auth/sso/{providerKey}/start            (unauthenticated; AUTH_SSO_ENABLED=true)
  -> resolve tenant (header/cookie/?tenantId), check tenant active + provider enabled
  -> create awcms_oidc_auth_requests: state(hash), nonce, code_verifier (PKCE), purpose='login'
  -> discovery (SSRF-guarded) -> 302 to authorization_endpoint
     (client_id, app-owned redirect_uri, response_type=code, scope, state=tenantId.token,
      nonce, code_challenge S256)

GET /api/v1/auth/sso/{providerKey}/callback         (IdP redirect; unauthenticated)
  -> parse state -> tenantId + token; resolve provider; consume state (FOR UPDATE + CAS, single-use)
  -> token exchange (SSRF-guarded, PKCE code_verifier + client secret)
  -> verify ID token: alg allow-list {RS256,ES256} + JWKS signature (WebCrypto)
     + issuer + audience + azp + expiry + iat + nonce  (all fail-closed)
  -> look up external identity (tenant_id, provider_id, issuer, subject)
     |  found        -> continue
     |  not + auto-link ON + email verified + domain allowed -> link to existing identity
     |  not + JIT ON + email verified + domain allowed + no collision -> provision identity (minimum privilege)
     |  otherwise    -> 401 SSO_ACCOUNT_NOT_LINKED
  -> if an active MFA factor exists -> 401 MFA_REQUIRED { mfaChallengeToken }  (finish via /auth/mfa/totp/verify -> aal2)
  -> otherwise -> mint opaque aal1 session, set cookie, 302 to returnTo (default /admin)
```

### 2.2 Account linking (explicit + step-up)

```
POST /api/v1/auth/sso/{providerKey}/link            (valid session + requireStepUp aal2)
  -> create oidc_auth_request purpose='link', identity_id = session identity (server-side)
  -> reply { authorizationUrl }  (browser navigates; callback purpose='link' creates the external identity)

POST /api/v1/auth/sso/{providerKey}/unlink          (valid session + requireStepUp aal2)
  -> delete the external identity; high severity audit
```

Linking is **never** automatic just because the email matches; it requires an authenticated session + a fresh MFA step-up.

### 2.3 Admin lifecycle (ABAC-guarded, audited)

```
GET/POST      /api/v1/auth/sso-providers            (sso_providers.read / .create)
GET/PATCH/DELETE /api/v1/auth/sso-providers/{id}    (.read / .update / .delete; soft delete)
GET/PATCH     /api/v1/auth/sso-policy               (sso_policy.read / .update)
```

The client secret is never returned; the response carries only `secretSource` (`encrypted`/`env`) and (for env) the variable name.

## 3. Provider setup guide

1. Provide the encryption key: `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -base64 32)`; set `AUTH_SSO_ENABLED=true`.
2. At the IdP (Google/Entra/Keycloak/…): register the OIDC application, redirect URI = `${APP_URL}/api/v1/auth/sso/{providerKey}/callback` (strict match), minimum scope `openid email profile`.
3. Create the provider via `POST /api/v1/auth/sso-providers`:
   - `providerKey` a stable slug (`^[a-z0-9][a-z0-9_-]*$`), used in the URL & as the linking key.
   - `issuerUrl` HTTPS (the base `.well-known/openid-configuration` is derived automatically).
   - `clientId`.
   - **Secret**: pick one — `clientSecret` (encrypted at-rest) OR `clientSecretEnvVar` (the env name; the real secret lives in a secrets manager and is never persisted).
   - `allowedEmailDomains` (optional; a precondition for auto-link/JIT).
   - `enabled: true`.
4. Set the tenant policy via `PATCH /api/v1/auth/sso-policy` (optional): `ssoEnabled`, `ssoRequired`, `autoLinkVerifiedEmail`, `jitProvisioningEnabled`, `allowedEmailDomains`, `breakGlassIdentityIds`.

> **auto-link WARNING (account takeover):** `autoLinkVerifiedEmail`/`jitProvisioningEnabled` (default OFF) link/create an identity based on `email` + `email_verified:true` from the IdP. This is **only safe** for domains **you fully control** and IdPs **you trust** for their `email_verified` claim. Do **NOT** enable it against consumer/public IdPs or shared domains (e.g. `gmail.com`, or a multi-organisation Entra tenant) where someone else can hold `email_verified:true` for an address that collides with a local `login_identifier` — that turns into a takeover primitive. Safe default: leave it OFF and require **explicit linking** (which needs a session + step-up). `allowedEmailDomains` (provider + policy) must be filled with your own domains when this feature is turned on.

> **Note on `sso_required`:** `sso_required=true` is **advisory** — it pushes users towards SSO but does **not** turn off password login unless you also set `password_login_enabled=false`. To genuinely require SSO, set both (and that triggers the break-glass precondition in §4). `sso_required=true` on its own is useful for UX/redirect, not for enforcement.

Preflight: `bun run config:validate` rejects `AUTH_SSO_ENABLED=true` without a valid 32-byte key, and a non-empty `AUTH_SSO_ALLOW_INSECURE_HOSTS` in production. `bun run security:readiness` enforces the same things (critical severity).

## 4. Break-glass SOP

**Goal:** guarantee that the local owner can always get in even when SSO is required or the IdP is down.

- **Policy precondition:** `sso_required=true` (or `password_login_enabled=false`) may only be stored when `breakGlassIdentityIds` contains ≥1 identity that is **currently** active (identity + tenant_user `active`). Otherwise → `409 BREAK_GLASS_REQUIRED`. `saveTenantAuthPolicy` stores only ids that pass verification (garbage ids are dropped).
- **MFA is mandatory:** a break-glass owner still passes through the tenant MFA enforcement (`awcms_tenant_mfa_policies`, `required_for_all`/`required_for_privileged`) — set the MFA policy so break-glass uses a second factor.
- **During an IdP outage:** SSO login fails fast (`SSO_PROVIDER_UNAVAILABLE`, circuit breaker); break-glass password login **still works** (a separate path that never touches the provider). This is proven in `tests/oidc-integration.test.ts`.
- **Control drift — now enforced:** a break-glass identity can become ineligible (deactivated, or its tenant membership revoked) without the policy ever being saved again, so the save-time guarantee above can become false without a single write to `awcms_tenant_auth_policies`. `bun run security:readiness` runs `checkSsoBreakGlassReady` (**critical** severity) which **re-derives** eligibility from the DB for **every active tenant** using the very same `fetchEligibleBreakGlassIdentityIds` + `evaluateBreakGlassRequirement` as the save path — not a second copy of the rules. Its evidence names each affected tenant along with the trigger: `password_login_enabled=false` (local login is OFF right now — the urgent variant) or `sso_required=true` alone (advisory; password login still works, see §3). One transaction per tenant, because `awcms_tenant_auth_policies` is FORCE RLS — this check runs under the same isolation as the application, with no cap/LIMIT. Incident procedure: verify at least one active, MFA-enrolled break-glass owner before enabling `sso_required`.
- **Rotation:** keep break-glass credentials in an offline vault; test break-glass login periodically; audit every `login_blocked_password_disabled` and every break-glass `login_succeeded`.

## 5. Privacy / data minimization (UU PDP, ISO/IEC 27701)

| Data                    | Source             | Stored?                                   | Notes                                                          |
| ----------------------- | ------------------ | ----------------------------------------- | -------------------------------------------------------------- |
| `sub` (subject)         | ID token           | Yes (`awcms_external_identities.subject`) | Stable pseudonymous identity; the linking key. Not direct PII. |
| `issuer`                | discovery/ID token | Yes                                       | Part of the external identity key.                             |
| email                   | ID token           | Only when auto-link/JIT                   | Used to match/JIT an identity; not used as the linking key.    |
| `email_verified`        | ID token           | No                                        | Evaluated at runtime only (a precondition for auto-link/JIT).  |
| ID token / access token | token endpoint     | **No**                                    | Never persisted; verified in-memory only.                      |
| client secret           | admin input/env    | Ciphertext or an env reference            | Never plaintext in the DB/logs/responses/audit.                |
| audit                   | server             | Yes, redacted                             | `providerKey` + counts; no raw tokens/secrets/claims.          |

Minimization: only `sub`+`issuer` (and email when the linking feature requires it) is persisted. The subject's linking data is deleted on unlink (`DELETE`). Audit retention follows the general audit policy.

## 6. Threat model

| Threat                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSRF** (issuer/JWKS/token URL from tenant data) | HTTPS-only; block private/loopback/link-local/ULA/CGNAT/metadata IPv4+IPv6 (including IPv4-mapped/NAT64); validate every DNS result before connecting; manual redirects + re-validation; timeout + size cap; per-`${tenant}:${provider}` breaker. The loopback escape hatch is only via `AUTH_SSO_ALLOW_INSECURE_HOSTS` (rejected in production). **Residual:** a DNS-rebinding flip after validation is not closed without a connect-time pin (bounded NOT by the 1-hour positive cache TTL, but by the 30-second negative cache + the per-`${tenant}:${provider}` circuit breaker; residual accepted, ADR-0028). |
| **Token substitution / alg confusion / `none`**   | Algorithm allow-list {RS256, ES256} matched against the key type; signature via WebCrypto; issuer/audience/azp/expiry/iat/nonce fail-closed; `sub` immutable (not email).                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **CSRF / callback replay**                        | The `state` bearer is hashed, single-use (FOR UPDATE + CAS), short TTL; `nonce` bound to the ID token; the PKCE `code_verifier` is single-use server-side.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Open redirect**                                 | `redirect_uri` is always app-owned (never client-supplied); the post-login `returnTo` is sanitized to a same-origin path (default `/admin`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Tenant confusion / cross-tenant**               | The tenant is resolved before the flow, bound into `state`, and re-derived at the callback; state is scoped `(tenant_id, provider_id, state_hash)`; RLS FORCE + tenant-bound composite FKs. Cross-tenant state substitution is rejected (`SSO_OAUTH_STATE_INVALID`).                                                                                                                                                                                                                                                                                                                                               |
| **Account takeover via linking**                  | Explicit linking + an authenticated session + MFA step-up; no auto-link on unverified email; the key is `sub`, not email. Residual (opt-in): `autoLinkVerifiedEmail`/`jitProvisioningEnabled` rely on the IdP's `email_verified` claim — if turned on against a consumer IdP/shared domain that emits `email_verified:true` for an address colliding with a local `login_identifier`, this becomes a takeover primitive. Default OFF; only for fully-owned domains + trusted IdPs (§3). JIT never overwrites an existing identity (collision → not-linked).                                                        |
| **IdP outage lockout**                            | Local break-glass password is separate from the provider path; the breaker fails fast; saving the policy rejects a configuration that would lock everyone out.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Secret leakage**                                | AES-256-GCM with no default key / an env reference; never in a response/log/audit; readiness gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Enumeration oracle**                            | An unknown provider → a generic `404` after the gate; the break-glass gate is only reached after a valid password; generic callback errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Internal DoS probing**                          | The breaker + negative cache only throw away attempts that FAILED (a legitimate login is never blocked); provider cap per tenant; per source+tenant rate limit on `/start`.                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 7. Configuration (env)

See the OIDC/SSO section of `.env.example`. In short: `AUTH_SSO_ENABLED`, `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY` (mandatory when enabled, 32-byte base64), `AUTH_SSO_DISCOVERY_TIMEOUT_MS`, `AUTH_SSO_MAX_RESPONSE_BYTES`, `AUTH_SSO_MAX_PROVIDERS_PER_TENANT`, `AUTH_SSO_OAUTH_REQUEST_TTL_SEC`, `AUTH_SSO_ALLOW_INSECURE_HOSTS` (test-only, empty in production).
