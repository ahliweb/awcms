🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0028-oidc-sso-tenant-aware-account-linking-break-glass.id.md)

# ADR-0028 — Tenant-aware OIDC/SSO, fail-closed account linking, and break-glass

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision makers:** maintainer
- **Related:** Issue #185, epic #177 (derived ERP foundation readiness); ADR-0027 (MFA/step-up, break-glass integration); ADR-0026 (modular OpenAPI); doc `docs/awcms/oidc-sso.md`; port from awcms-mini Issue #590/#591 (adapted, not copied).

## Context

AWCMS uses local password login + opaque sessions. Large-organisation ERP needs federated identity through OpenID Connect so it can connect to Google Workspace, Microsoft Entra ID, Keycloak, or another IdP — without making the external provider the final authorization source. The implementation must be tenant-aware: one deployment serves many tenants with different issuer/client policies; a linking or tenant-resolution mistake can lead to account takeover or cross-tenant access.

The generic OIDC slice is already mature in awcms-mini (Issue #591), but mini made two decisions that do **not** fit this base: (1) mini deliberately does **not** block private/loopback/metadata IPs on `issuer_url` (assuming a full-online profile reaching an on-prem IdP over VPN), and (2) mini gates SSO behind the "full-online" gate (#587) which was not ported. On top of that, this base's login path is **harder** than mini's (anti-timing dummy hash, collapsed deny reasons, `TRUSTED_PROXY_ENABLED`) — a naive port could regress it.

## Decision

We decided to **port the generic OIDC framework from mini and harden it** for this base, with the following adaptations:

1. **Feature switch = `AUTH_SSO_ENABLED` only** (no full-online gate). This flag gates the login/callback/link/unlink flow; admin provider/policy CRUD is always available (provision a provider before flipping the flag). Provider configuration (issuer/client id/secret/scope/domain) is **per-tenant DATA** (`awcms_auth_providers`), not env.
2. **Dedicated SSRF guard (`src/lib/auth/ssrf-guard.ts`) — the issue's #1 risk.** Every discovery/JWKS/token fetch must be HTTPS (except hosts explicitly allow-listed for a local fake IdP during tests), blocks private/loopback/link-local/ULA/CGNAT/metadata/multicast/reserved IPv4+IPv6 (including IPv4-mapped/NAT64 forms that smuggle v4 in), validates **every** DNS resolution result before connecting (defence against the DNS-rebinding shape), follows redirects **manually + re-validates each hop**, plus a timeout + response-size cap. This is the opposite of mini's risk-acceptance decision.
3. **Auth Code Flow + PKCE + `state` + `nonce`.** The `code_verifier` is stored server-side single-use (`awcms_oidc_auth_requests`), the S256 `code_challenge` is sent to the IdP. `state` is a bearer credential (sha256-hashed at rest); `nonce`/`code_verifier` stay plaintext (they are not bearers themselves). State is single-use concurrency-safe (`SELECT … FOR UPDATE` + compare-and-swap), bound to the tenant from `start` through `callback`.
4. **Fail-closed ID token validation** (`oidc-policy.ts` + `jwt-verify.ts`): issuer, audience, signature via JWKS, expiry, `iat` sanity, nonce, `azp` (mandatory when the audience is plural), and an **algorithm allow-list {RS256, ES256}** matched against the key type (rejects `none` and alg-confusion). Signatures are verified with native WebCrypto (Bun-only, no `jose` dependency).
5. **External identity keyed by `(tenant_id, provider_id, issuer, subject)`** (`awcms_external_identities`) — immutable `sub`, never email. Different from mini, which uses `(tenant_id, provider, subject)`; `issuer` is added to the key and `provider_id` becomes a tenant-bound composite FK.
6. **JWKS/discovery cache** with a bounded TTL + negative-TTL + circuit breaker (reusing `getProviderCircuitBreaker`), keyed `${tenantId}:${providerKey}` — **outside** the DB transaction (ADR-0006). The breaker only trips on transport/SSRF failures, not on 4xx driven by attacker input.
7. **Explicit account linking + step-up (#184).** `POST /sso/{providerKey}/link` requires a valid session **and** `requireStepUp` (fresh aal2) — the identity is taken server-side from the already-stepped-up session, never from the callback. It does NOT auto-link merely because the email matches.
8. **Auto-link & JIT provisioning default OFF.** Auto-link requires a tenant master switch + a verified email + the provider's domain (and the domain policy when set). JIT (off by default) creates a new identity at **minimum privilege** (no role — authorization is default-deny) only for a verified email on an allow-listed domain and only when there is no `login_identifier` collision.
9. **Break-glass is enforced at policy SAVE time** (`saveTenantAuthPolicy`): `sso_required=true` or `password_login_enabled=false` may only be saved when ≥1 break-glass identity is still active (identity + tenant_user `active`). At login time (`isPasswordLoginDisabledForIdentity`, gated by `isSsoEnabled`) password login for a non-break-glass identity is rejected **before** the MFA branch — so it cannot be bypassed through a challenge. An IdP outage never blocks break-glass (the local password path is separate from the provider path).
10. **The OIDC result is an opaque AWCMS session**, not the ID token as a session. Success with no active MFA factor → an `aal1` session (`createSessionWithAssurance`, reusing the #184 assurance columns); with an active factor → challenge → the existing MFA route mints `aal2`. The post-login redirect is a validated same-origin `returnTo` (default `/admin`) — anti open-redirect.
11. **The client secret is never plaintext in the DB/log/response/audit.** It is stored as `client_secret_ciphertext` (AES-256-GCM, `AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, with no default key) OR as `client_secret_env_var` (an env name, resolved at token-exchange time). The admin response only exposes `secretSource`.
12. **The base's harder login path is preserved intact** — the break-glass gate only inserts one branch between the deny block (which already `return`s) and the MFA branch; `resolveLoginPolicyConfig`/`verifyPasswordOrDummy` are untouched, and none of mini's `Number(process.env…)` came along.

## Consequences

- New tables with RLS `ENABLE`+`FORCE` (`awcms_auth_providers`, `awcms_tenant_auth_policies`, `awcms_external_identities`, `awcms_oidc_auth_requests`) — cross-tenant denial is proven under the non-superuser role `awcms_app` (`tests/oidc-integration.test.ts`).
- The SSRF guard is a small port/adapter with its own unit tests (`tests/oidc-ssrf.test.ts`); the residual DNS-rebinding window (IP flips after validation, before connect) cannot be closed without a connect-time socket pin, which Bun's `fetch` does not expose — this is documented in the threat model. The real bound is **not** the positive cache TTL (1 hour, not populated during a rebind) but the 30-second negative cache + the per-`${tenant}:${provider}` circuit breaker.
- **Residual auto-link (opt-in, accepted):** `autoLinkVerifiedEmail`/`jitProvisioningEnabled` (default OFF) rely on the IdP's `email_verified`; if a tenant turns them on against a consumer IdP / shared domain, an `email_verified:true` address that collides with a local `login_identifier` becomes a takeover primitive. Per the AC (only auto-link on unverified email / on-by-default is forbidden), the feature is KEPT but the doc warns bluntly: only for fully-owned domains + trusted IdPs. JIT never overwrites an existing identity (collision → not-linked).
- Mini's `mfa_required` in `tenant_auth_policies` is **dropped** (the base already has `awcms_tenant_mfa_policies`, sql/024) so there are not two sources of truth.
- Two new public operations (`getAuthSsoStart`, `getAuthSsoCallback`) enter the reviewed `ALLOWED_PUBLIC_OPERATIONS` allow-list.

## Rejected alternatives

- **Following mini's "do not block private IPs" decision** — rejected; issue #185 makes SSRF the primary security requirement.
- **Full SAML / SCIM** — out of the issue's scope.
- **The ID token as the session** — rejected; authorization stays with AWCMS RBAC/ABAC over an opaque session.
- **Adding a `jose`/`jsonwebtoken` dependency** — rejected (Bun-only); native WebCrypto is enough for RS256/ES256.
