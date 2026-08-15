---
name: awcms-auth-online-hardening
description: Cross-feature design context for awcms online auth hardening (Turnstile, MFA/TOTP, OIDC/SSO, admin policy UI). IMPORTANT — the issue numbers #587-#593, file names, table names, migration numbers, and endpoint paths in the body of this skill belong to ANOTHER repo (awcms-micro); in awcms every one of them is named DIFFERENTLY. Read §Map to the real awcms artifacts first, then treat the rest as design-rationale notes, not path references. The capabilities THEMSELVES already exist in awcms per #184/#185/#186/#274 — do not rebuild them.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Full-Online Auth Security Hardening

> **READ THIS FIRST — this document has two layers, and only one of them can
> be trusted as paths.** The body of the skill below was copied from the
> `awcms-micro` epic "full-online auth security hardening". **Every issue
> number (#587–#593, #598, #605), file name (`auth-security-status.ts`),
> migration number (`036`), and endpoint path (`/api/v1/identity/sso/*`,
> `/api/v1/auth/providers/google/*`) below belongs to THAT repo, not this
> one.** The 2026-07-18 audit was right when it concluded that not one of
> them is found in awcms `src/` — but the conclusion drawn at the time ("this
> epic is fictional, build it from scratch") **is now wrong in the opposite
> direction**: the capabilities have been built in awcms since then, under
> their own names.
>
> **What must be taken from this document is its DESIGN RATIONALE** (the
> combined gate, fail-closed, anti-enumeration, circuit breaker blast radius,
> the MFA-vs-reset boundary) — that still holds and has already proven
> expensive to re-derive. **What must NOT be taken are its paths/names/numbers.**
> See §Map to the real awcms artifacts right below, then verify against the code.

Six **online-only** auth hardening features (Cloudflare Turnstile, MFA/TOTP,
Google OIDC login, generic tenant OIDC SSO, admin policy UI, plus the
docs/contract closer) on top of local/password login + opaque sessions,
without changing the default offline/LAN/local behaviour. Its gate model in
awcms:

```txt
AUTH_ONLINE_SECURITY_ENABLED + AUTH_ONLINE_SECURITY_PROFILE=full_online
  -> isFullOnlineSecurityActive(env) === true
    -> Turnstile boleh aktif
```

**An important divergence from the micro model above.** In awcms only
**Turnstile** is still gated by the deployment profile. MFA and OIDC/SSO
**dropped** that gate when they were ported (#184/#185): both are driven by
**per-tenant DB state** (MFA enrollment, the `awcms_tenant_auth_policies`
row), not a global env var — `AUTH_MFA_ENABLED` only gates _new enrollment_,
while the challenge and step-up run off state. Reading this document as if
"every feature is gated by `isFullOnlineSecurityActive`" will be wrong.

## Map to the real awcms artifacts

Left column = the name used in the body of this skill (belonging to
awcms-micro). Right column = what actually exists in this repo. **Always use
the right column.**

| Called below (micro)                 | Actually in awcms                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `auth-security-status.ts`            | no equivalent; the posture is assembled directly in `src/pages/admin/security.astro`       |
| migration `036`                      | `sql/024` (MFA), `sql/025`+`sql/026` (OIDC/SSO + permission seed)                          |
| `awcms_identity_mfa_factors`         | `awcms_principal_mfa_factors` since `sql/114` (ADR-0087) — see the note below              |
| `awcms_identity_mfa_recovery_codes`  | `awcms_principal_mfa_recovery_codes` since `sql/114` (ADR-0087)                            |
| `/api/v1/identity/sso/providers`     | `/api/v1/auth/sso-providers` (+ `/[id]`)                                                   |
| `/api/v1/identity/sso/policy`        | `/api/v1/auth/sso-policy` (`PATCH`)                                                        |
| `/api/v1/auth/providers/google/*`    | **does not exist** — awcms only has generic OIDC `/api/v1/auth/sso/[providerKey]/*`        |
| "admin policy UI #592"               | `src/pages/admin/security.astro` (#274) — see `identity-access/README.md`                  |
| Issue #587–#593, PR #598, Issue #605 | micro numbers; awcms equivalents: #184 (MFA), #185 (OIDC/SSO), #186 (Turnstile), #274 (UI) |

What **does exist** under the same name: `src/lib/auth/online-security-config.ts`,
`src/lib/security/turnstile.ts`, `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE`,
`isFullOnlineSecurityActive`, `checkOnlineAuthSecurityReady`,
`awcms_auth_providers`, `awcms_tenant_auth_policies`.

**A change that makes part of the design rationale below no longer hold as
written — [ADR-0087](../../../docs/adr/0087-mfa-moves-to-the-principal.md),
`sql/114`.** MFA factors and recovery codes now belong to the **human**
(`awcms_principal_mfa_factors` / `awcms_principal_mfa_recovery_codes`, keyed by
`principal_id`, GLOBAL and without RLS), not to the per-tenant identity. What
**remains true** in the body of the skill: the `last_used_step` replay guard
must be an atomic compare-and-swap, recovery code consumption must be
`... AND used_at IS NULL RETURNING`, a password reset is not an MFA bypass,
and re-enroll is rejected while a factor is active — the `sql/024` mechanism
is reused wholesale, only its rows moved. What is **no longer true**: the
table names, the claim that the MFA tables are tenant-scoped under FORCE RLS
(both principal tables are deliberately without RLS; their replacement is the
four ADR-0085 controls plus the `bun run identity:principal-access:check`
gate), and the assumption that an administrative reset stops at the tenant
boundary — **it now reaches outward**, recorded as `crossTenantReach` in the
audit and `disabled_by_tenant_id` on its row.
Before touching MFA, read `docs/awcms/mfa-totp-step-up.md` first.

Auth features that exist in awcms but are **not** discussed in this document
at all (do not conclude "not there yet" from its silence): password reset by
email (`sql/073`), self-registration with admin approval (`sql/074`–`075`),
business-scope, SoD, and the ABAC DSL. Refer to
`src/modules/identity-access/README.md`.

## When to use this skill vs the generic skills

This skill complements (does not replace) `awcms-new-endpoint`,
`awcms-new-migration`, `awcms-idempotency`,
`awcms-abac-guard`, `awcms-audit-log`, and
`awcms-sensitive-data` (provider credentials, TOTP seeds, recovery
codes are all sensitive data). This skill supplies the context that is
**cross-cutting and specific to this epic**: the shared gate every feature
must check, and the design decisions that bind every issue in this epic at once.

## Status in awcms (do not rebuild what already exists)

The issue numbers in the left column are the **micro** numbering used by the
body of this skill; the PRs in the right column are the actual **awcms** work.

| Scope (micro numbering)                                      | Status in awcms                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Shared gate `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE` (#587) | ✅ exists — `src/lib/auth/online-security-config.ts`, `checkOnlineAuthSecurityReady`                          |
| Cloudflare Turnstile for public auth forms (#588)            | ✅ exists (#186) — `src/lib/security/turnstile.ts`; the **only** feature still gated by the profile           |
| MFA/TOTP login challenge (#589)                              | ✅ exists (#184, `sql/024`) — enforcement comes from DB state, NOT from the profile gate                      |
| Google OIDC login (#590)                                     | ❌ **absent, and deliberately so** — awcms has generic OIDC; a Google-specific port only on request (roadmap) |
| Generic tenant OIDC SSO provider (#591)                      | ✅ exists (#185, `sql/025`/`026`) — different paths & migrations, see §Map                                    |
| Admin UI for the online auth security policy (#592)          | ✅ exists (#274) — `src/pages/admin/security.astro`; provider CRUD is still API-only                          |
| Docs/contract/readiness epic closer (#593)                   | 🟡 partial — awcms's readiness check & threat model have their own track; do not use the micro audit list     |

## What already exists — reuse it, do not re-derive

### Shared gate (Issue #587, `src/lib/auth/online-security-config.ts`)

Two env vars, **both optional/backward-compatible** — not set at all
(the default for every offline/LAN/local deployment), `config:validate`
still PASSes and there is no change in login behaviour whatsoever:

- `AUTH_ONLINE_SECURITY_ENABLED` — `"true"` activates the gate,
  any other value (including unset) means off.
- `AUTH_ONLINE_SECURITY_PROFILE` — `"disabled"` (default) or
  `"full_online"`. **Must** be `"full_online"` if `AUTH_ONLINE_SECURITY_ENABLED=true`
  — any other combination fails `bun run config:validate`
  (`checkOnlineAuthSecurityConfig`, `scripts/validate-env.ts`).

Three functions are exported:

- `isOnlineSecurityEnabled(env)` — checks the flag only.
- `resolveOnlineSecurityProfile(env)` — always falls back to `"disabled"`
  for empty/unknown values, never throws.
- **`isFullOnlineSecurityActive(env)` — the only function every feature
  #588-#592 MUST call before doing anything
  online/provider-related.** Do not re-derive the "both must
  agree" rule in another module — import this function directly.

`scripts/security-readiness.ts`'s `checkOnlineAuthSecurityReady`
reports the status of this gate (severity `critical` so that a genuine
misconfiguration still blocks go-live, but `status: pass` for the
disabled condition — informational, not a failure, per #587's acceptance
criteria). Full env var details: `docs/awcms/18_configuration_env_reference.md`
§Full-online auth security hardening,
`docs/awcms/deployment-profiles.md` §Full-online auth security
hardening, `src/modules/identity-access/README.md` §Full-online-only
auth security feature gate.

### Cloudflare Turnstile (Issue #588, `src/lib/security/turnstile.ts`)

The **first** concrete feature built on top of the #587 gate — the
reference pattern for #589-#592 that follow. Combined gate:

```txt
isTurnstileRequired(env)
  = isFullOnlineSecurityActive(env) AND isTurnstileEnabled(env)
  (isTurnstileEnabled = TURNSTILE_ENABLED === "true")
```

- **One enforcement function called from 4 endpoints**:
  `enforceTurnstileIfRequired(turnstileToken, remoteIp, env)` — called
  in `POST /api/v1/auth/login`, `/auth/password/forgot`, `/auth/password/reset`,
  and `/setup/initialize`, right after the body is validated but **before**
  DB/password hashing (issue's security note: verifying Turnstile is
  cheaper, do not burn expensive work on a request that does not even pass
  the bot check). Returns `{ok:true}` or `{ok:false, code:
"TURNSTILE_REQUIRED" | "TURNSTILE_INVALID"}` — **fail closed**:
  a misconfiguration (`resolveTurnstileConfig` → `null`) is treated exactly
  like an invalid token, not skipped.
- **Env var verification is independent of the #587 gate**: `TURNSTILE_ENABLED=true`
  on its own already requires `TURNSTILE_SITE_KEY`+`TURNSTILE_SECRET_KEY`
  in `config:validate`/`security-readiness` (`checkTurnstileConfig`,
  `scripts/validate-env.ts`) — an operator may fill these credentials in
  first without switching `AUTH_ONLINE_SECURITY_ENABLED` on; runtime
  activation still needs BOTH gates to agree.
- **`verifyTurnstileToken`** calls Cloudflare siteverify server-side
  (issue's security note: "client widget alone is not security"),
  timeout-bounded (`withTimeout`) + circuit breaker
  (`getProviderCircuitBreaker("turnstile")`), the same pattern as
  `cloudflare-dns-adapter.ts`/`mailketing-provider.ts` — **with one
  important difference that must be preserved**: `breaker.recordFailure()`
  is called ONLY for genuine transport failures to Cloudflare (non-2xx
  HTTP, unparseable body, network error/timeout), NEVER for a legitimate
  2xx response with `success:false` (that is Cloudflare answering
  correctly that the client's token is wrong — a normal outcome anyone
  can trigger without authentication). The PR #596 security review found
  the first version conflated the two: this breaker is shared/cross-tenant,
  and `enforceTurnstileIfRequired` fails closed while the breaker is open, so
  an attacker could lock login/password-reset/setup for ALL tenants just
  by sending a handful of junk tokens every ~30 seconds. Do not
  regress this pattern in other online features (#589-#592) that add a
  new provider circuit breaker — always distinguish "the provider is unhealthy"
  from "the provider correctly rejected the client's input". The
  `turnstile.circuit_breaker_open`/`turnstile.provider_call_failed`/
  `turnstile.provider_call_errored` logs (severity `warning`,
  `src/lib/logging/logger.ts`) give operational visibility into
  both.
- **CSP** (`astro.config.mjs`): `script-src`/`frame-src` allow
  `https://challenges.cloudflare.com` **unconditionally** (not gated by
  `TURNSTILE_ENABLED` at build time) — the reason is documented
  right in that file: Astro's CSP can only be baked at build time,
  whereas `TURNSTILE_ENABLED` is designed to be runtime-toggleable like every
  other flag; the widget itself is still runtime-gated through `isTurnstileRequired()`
  in `login.astro`.
- **The widget UI** is only rendered in `login.astro` (the other public forms —
  forgot/reset/setup — do not have UI pages in this repo yet, only their
  API endpoints) when `isTurnstileRequired()` is true; the token is sent as the
  optional `turnstileToken` field in the JSON body, read from the hidden
  `cf-turnstile-response` field the widget fills in automatically.
- i18n error codes: `error.turnstile_required`/`error.turnstile_invalid`
  (`src/lib/i18n/error-messages.ts`, `i18n/en.po`+`id.po`).

### MFA/TOTP (Issue #589, `src/modules/identity-access/application/mfa.ts`)

The combined gate follows exactly the same pattern as Turnstile:

```txt
isMfaRequired(env)
  = isFullOnlineSecurityActive(env) AND isMfaEnabled(env)
  (isMfaEnabled = AUTH_MFA_ENABLED === "true")
```

- **MFA is opt-in per identity, not mandatory tenant-wide** — even
  with the gate active, an identity that has never enrolled still logs in
  normally (`login.ts` checks `findActiveMfaFactor` per identity AFTER
  the password is valid, not just the env gate). Do not assume that turning
  `AUTH_MFA_ENABLED=true` on automatically makes MFA mandatory for all users.
- **Login is suspended, not rejected**: valid password + an `active` factor
  → `login.ts` does NOT create a session, and instead inserts an
  `awcms_mfa_challenges` row and answers `401 MFA_REQUIRED` carrying
  `error.details.mfaChallengeToken` (the shape of `details` here is
  DELIBERATELY not `ErrorDetail[]` like other endpoints — see the OpenAPI
  schema `LoginMfaRequiredResponse` — because an actual payload (the token)
  has to be returned, not merely an array of validation messages).
  `POST /auth/mfa/totp/verify` is **the only MFA endpoint that does
  NOT need a session** — it is authenticated by the challenge
  possession token, the same pattern as `password/reset` being authenticated by
  the reset possession token. A valid code/recovery code → the session is
  created identically to `login.ts` (same token, cookie, response shape), so
  the client needs no different logic for the second step.
- **Encryption-at-rest, not hashing, for the TOTP secret** —
  `src/lib/auth/mfa-secret-crypto.ts` (AES-256-GCM,
  `AUTH_MFA_SECRET_ENCRYPTION_KEY`, base64 32-byte, validated by
  `checkMfaConfig`) — the only secret in this application that is
  reversible, because verifying TOTP requires recomputing the code from
  the original secret on every request, unlike a password/token where
  comparing the hash is enough. Recovery codes (`mfa-recovery-code.ts`) and
  challenge tokens (`mfa-challenge-token.ts`) stay hash-only (sha256,
  the same pattern as `session-token.ts`/`password-reset-token.ts`) — NOT
  reversible, because neither ever needs to be displayed again
  after being revealed once at the start.
- **Replay prevention, and it MUST be atomic, not read-then-write** —
  `awcms_identity_mfa_factors.last_used_step` stores the highest TOTP
  time-counter step ever accepted; a verification is only
  accepted if the matching step is STRICTLY GREATER than this value
  (`src/lib/auth/totp.ts`'s `verifyTotpCode`, default ±1 step window).
  **The PR #597 security review found that `verifyMfaChallenge` initially
  did a separate SELECT then UPDATE** (for `last_used_step`,
  `awcms_identity_mfa_recovery_codes.used_at`, AND
  `awcms_mfa_challenges.failed_attempts`) — under READ COMMITTED
  (Postgres's default; `withTenant` does not change the isolation level),
  concurrent verification requests all read the old state before any of them
  commits, so both the replay guard and the `failed_attempts` limit could be
  bypassed entirely by an attacker sending parallel guesses.
  Fixed with: (a) `SELECT ... FOR UPDATE` on the challenge row at the
  start of `verifyMfaChallenge` (locking that row for the rest of the
  transaction, serializing every verification request against the same challenge),
  (b) compare-and-swap for `last_used_step`
  (`UPDATE ... WHERE last_used_step < $step RETURNING id`, 0 rows = failure
  — protecting against cross-challenge replay that FOR UPDATE alone does not
  reach, e.g. two different login attempts creating two separate challenges
  for the same identity), (c) the same compare-and-swap for the
  recovery code (`UPDATE ... WHERE used_at IS NULL RETURNING id`). Other
  online features that add single-use/counter state that can be
  verified repeatedly (other OTP codes, etc.) MUST use the same atomic
  pattern — never SELECT to evaluate a condition and then UPDATE
  separately to mark it used/failed; its regression tests:
  `mfa-flow.integration.test.ts` §"concurrent verification attempts..."
  and §"concurrent wrong-code attempts...".
- **A password reset is NOT an MFA bypass** — `completePasswordReset` does not
  touch the `awcms_identity_mfa_factors` table at all;
  verified by an explicit integration test (`mfa-flow.integration.test.ts`
  §"password reset does not disable MFA").
- **Re-enroll is rejected while a factor is active** (`409 MFA_ALREADY_ACTIVE`,
  `POST /auth/mfa/totp/enroll/start`) — a hijacked session cannot
  silently swap the TOTP secret without first calling `disable`.
- **Disable & regenerate recovery codes = high-risk, audited**
  (`mfa_disabled`/`mfa_recovery_codes_regenerated`,
  severity `warning`) — the same pattern as `awcms-audit-log`. **A design
  note that has not been closed** (PR #597 review, not blocking): both
  of these endpoints only require a valid session, with no additional
  re-authentication (the current password/the current TOTP code) — a hijacked
  session (not merely one stolen before MFA was active) is enough to turn off
  the victim's MFA or throw away their old recovery codes. Accepted as a
  trade-off for issue #589's current scope; follow-on online features (e.g.
  #592 admin policy UI) that touch this area should consider
  step-up re-auth at this point.
- i18n error codes: `error.mfa_required`/`_disabled`/`_already_active`/
  `_not_active`/`_enrollment_not_found`/`_invalid_code`/
  `_challenge_invalid`/`_misconfigured` (`error-messages.ts`,
  `i18n/en.po`+`id.po`).

### Google OIDC login (Issue #590, `src/modules/identity-access/application/google-oidc.ts`)

The combined gate follows exactly the same pattern as Turnstile/MFA:

```txt
isGoogleLoginRequired(env)
  = isFullOnlineSecurityActive(env) AND isGoogleLoginEnabled(env)
  (isGoogleLoginEnabled = AUTH_GOOGLE_LOGIN_ENABLED === "true")
```

- **Tenant id travels in `state`, not a header** — `GET .../callback` is
  Google's redirect target (a pure browser navigation), which CANNOT
  carry the `X-AWCMS-Tenant-ID` header like other endpoints. The `state`
  sent to Google has the form `${tenantId}.${rawToken}`
  (`src/lib/auth/oauth-state-token.ts`'s `buildOAuthStateParam`/
  `parseOAuthStateParam`) — the tenant id is NOT a secret, so it is safe to
  appear in the URL; the token part (the real CSRF/replay defence, ≥32
  random bytes) is still hashed at rest like every other
  `state`/session/reset/challenge token in this application. Other online
  features that need a redirect to an external provider (e.g. #591 generic
  SSO) MUST use the same pattern to carry the tenant id — do not assume a
  header is always available on a redirect-target endpoint.
- **Two different flows from one orchestrator**: `GET .../start`
  (unauthenticated, from the "Continue with Google" button on `/login`)
  is always `purpose='login'`. `POST .../link` (REQUIRES a session — the
  identity is taken server-side from the currently logged-in session, NEVER
  trusted from the callback request) returns the `authorizationUrl`
  as JSON (not a 302 redirect), because it is called via `fetch()`
  from an already-authenticated context — the client does its own
  `window.location`. `GET .../callback` (the only Google redirect target)
  handles BOTH purposes through one orchestrator,
  `completeGoogleOAuthCallback` (application layer), based on the
  `purpose`/`identity_id` columns of the `awcms_oidc_auth_requests` row
  stored at start/link time — NOT two separate implementations that could
  diverge on security.
- **FULL cryptographic ID token verification, not merely a JSON decode**
  (issue's security note: "Do not trust query parameters alone; validate
  ID token cryptographically") — the RS256 signature via WebCrypto
  `crypto.subtle` (`src/lib/auth/jwt-verify.ts`, NO external JWT
  library), then issuer/audience/expiry/nonce
  (`google-oidc-policy.ts`'s `validateIdTokenClaims`, pure/testable).
  Every failure collapses into a generic `GOOGLE_ID_TOKEN_INVALID`
  (anti-enumeration, the same pattern as `MFA_CHALLENGE_INVALID`) — do NOT
  leak the specific reason (wrong issuer vs wrong audience vs invalid
  signature) into the response.
- **Provider accounts are linked via `sub`, NEVER via email**
  (issue's security note: "Use `sub` as the stable provider key") —
  `awcms_identity_provider_accounts`, unique per
  (tenant, provider, subject) AND per (tenant, identity, provider).
  Auto-link by email is ONLY active when `email_verified=true` AND the
  email domain is in `AUTH_GOOGLE_ALLOWED_DOMAINS` (`isEmailDomainAllowed` —
  **fail-closed**: an empty/unset list = auto-link is ALWAYS refused,
  not "allow every domain"). If no provider account matches
  and auto-link does not apply → `401 GOOGLE_ACCOUNT_NOT_LINKED`,
  NEVER provisioning a new identity (self-service registration via
  Google is explicitly out of scope for this issue).
- **Google login NEVER bypasses MFA** (issue's acceptance
  criterion: "If #589 is implemented and MFA is required, Google login
  still proceeds through MFA challenge before session creation") —
  `completeGoogleOAuthCallback` calls exactly the SAME `findActiveMfaFactor`/
  `createMfaChallenge` as `login.ts` (not a separate
  MFA path that could be forgotten in the wiring). The `callback.ts` endpoint
  returns `401 MFA_REQUIRED` with an `mfaChallengeToken` of the same
  shape as the one from `login.ts` — the client finishes through the
  existing `POST /auth/mfa/totp/verify`, no new MFA endpoint
  is needed for other OIDC providers.
- **The circuit breaker ONLY trips on genuine transport failures** —
  a direct lesson from the Turnstile bug (PR #596 security review, see
  §Cloudflare Turnstile above): a token exchange that answers `400
invalid_grant` for a wrong/used/expired `code` is Google
  CORRECTLY rejecting attacker-controlled input, not a sign that Google is unhealthy
  — `google-oauth-client.ts`'s `exchangeAuthorizationCode` ONLY calls
  `recordFailure` on 5xx/network error/timeout, never on a
  valid 4xx response. The JWKS is cached for 1 hour (`fetchGoogleJwks`) —
  do not fetch JWKS on every request.
- **NEVER INSERT/UPDATE with a `tenantId` that has not been validated
  BEFORE a safe `SELECT`** — the PR #598 security review found that
  `GET .../start` initially went straight to `INSERT INTO
awcms_oidc_auth_requests` with a `tenantId` from an
  unauthenticated query param WITHOUT first checking that the tenant
  actually exists. `tenant_id` has an FK to `awcms_tenants` — a bogus tenant
  triggers a foreign-key violation, and that exception is caught by
  `withTenant`'s catch-all and then recorded into
  **`getDatabaseCircuitBreaker()`, the single APPLICATION-WIDE breaker**
  (different from the per-provider breakers that Turnstile/Google have of
  their own — this breaker is used by ALL endpoints, ALL tenants). Five
  requests with random `tenantId`s from an unauthenticated attacker can
  open this breaker and take the WHOLE application down for 30 seconds,
  repeated endlessly — a blast radius bigger than the Turnstile bug in
  PR #596. Fixed with `SELECT status FROM awcms_tenants
WHERE id = tenantId` (safe, never throws for an empty row)
  BEFORE calling `createOAuthRequest`, plus rate limiting
  (`checkRateLimit`, the same pattern as `login.ts`) as a second layer. Other
  online features (e.g. #591 generic SSO) that have an unauthenticated
  endpoint with an INSERT/UPDATE carrying an FK to a tenant-scoped table
  MUST use the same pattern — check existence/status via SELECT first, and
  never let a write that can fail an FK constraint be the first row
  that touches the DB for unauthenticated input.
  Regression test: `google-oidc-flow.integration.test.ts` §"start
  rejects a nonexistent tenant WITHOUT tripping the shared database
  circuit breaker".
- `POST .../link`/`.../unlink`: high-risk, audited
  (`google_account_linked`/`google_account_unlinked`); a successful login in
  `callback.ts` is audited as `google_login_succeeded`.
- i18n error codes: `error.google_login_disabled`/
  `_oauth_state_invalid`/`_token_exchange_failed`/`_id_token_invalid`/
  `_account_not_linked`/`_already_linked`/`_not_linked`/`_misconfigured`
  (`error-messages.ts`, `i18n/en.po`+`id.po`).

### Generic tenant OIDC SSO provider (Issue #591, `src/modules/identity-access/application/tenant-sso.ts`)

Generalizes #590's Google-specific login into a tenant-CONFIGURED
provider model, WITHOUT touching Google's own code/tables — a deliberate
PARALLEL implementation, not a refactor of `google-oidc.ts`:

- **Reuses `awcms_oidc_auth_requests`/`awcms_identity_provider_accounts`
  (migration 035) as-is** — both were already generic (`provider text`,
  no CHECK constraining it to `'google'`) specifically so this issue
  wouldn't need a schema change to them. Generic SSO stores
  `provider = <providerKey>` in the exact same rows Google's own flow
  stores `provider = 'google'` in. New tables (migration 036) are only
  `awcms_auth_providers` (tenant-configured provider config: `provider_key`,
  `issuer_url`, `client_id`, client secret — encrypted at rest
  (`AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`, AES-256-GCM, SEPARATE key from
  MFA's own `AUTH_MFA_SECRET_ENCRYPTION_KEY`) OR an env-var-name
  reference, exactly one via CHECK constraint, NEVER returned plaintext
  by any endpoint; `scopes`, `allowed_email_domains` jsonb, `enabled`,
  soft delete) and `awcms_tenant_auth_policies` (one row per
  tenant: `password_login_enabled`, `sso_enabled`, `sso_required`,
  `auto_link_verified_email`, `allowed_email_domains` jsonb,
  `break_glass_identity_ids` jsonb, `mfa_required` reserved for future
  #589 compatibility, not yet enforced). Both RLS `ENABLE`+`FORCE`.
- The combined gate `isSsoRequired(env)` (`src/lib/auth/sso-config.ts`) =
  `isFullOnlineSecurityActive(env)` (#587) ∧ `AUTH_SSO_ENABLED=true` —
  same shape as every other feature's gate in this epic.
- **OIDC discovery is unavoidable here** (unlike Google's hardcoded
  endpoint constants) — `discoverOidcConfiguration`/`fetchProviderJwks`
  (`src/lib/auth/generic-oidc-client.ts`) fetch
  `.well-known/openid-configuration` + JWKS from each provider's own
  `issuer_url`, cached 1h, bounded by `AUTH_SSO_DISCOVERY_TIMEOUT_MS`
  (issue's own acceptance criterion: "OIDC discovery and JWKS fetches
  have bounded timeout"). Circuit breakers are keyed PER PROVIDER
  (`sso-oidc-discovery:<providerKey>`/`sso-oidc-jwks:<providerKey>`/
  `sso-oidc-token:<providerKey>`) — a slow/unhealthy provider on one
  tenant must never affect another tenant's or provider's login. Same
  PR #596/#598 rule applied from day one: only a genuine transport
  failure (5xx/network/timeout) trips the breaker, never a well-formed
  4xx (bad/reused/expired `code`) — the provider correctly rejecting
  attacker-controlled input is a healthy-provider signal.
- **Endpoints mirror Google's own shape exactly**: `GET
/auth/sso/{providerKey}/start` (unauthenticated, tenant resolved from
  header/cookie/`?tenantId=`, tenant existence/status `SELECT`ed BEFORE
  any INSERT into the reused `awcms_oidc_auth_requests` — applying
  PR #598's fix from the very first version of this endpoint, not as an
  afterthought), `GET .../callback` (re-checks `provider.enabled` again
  at callback time — an admin may have disabled the provider between
  `start` and the user completing the flow at the external provider),
  `POST .../link`/`.../unlink` (identical session/audit shape to
  Google's).
- **Admin CRUD is IN SCOPE for #591** (unlike #590 which had none) —
  `identity_access.sso_providers.{read,create,update,delete}` and
  `identity_access.sso_policy.{read,update}` (migration 037 permission
  seed) protect `/api/v1/identity/sso/providers`(`/{id}`) and
  `/api/v1/identity/sso/policy`. Deliberately NOT gated by
  `isSsoRequired()` — an admin may configure a provider ahead of
  flipping the deployment-level gate on, same allowance
  `checkGoogleOidcConfig`/`checkTurnstileConfig` already grant for their
  own credentials; no network/provider call happens in the CRUD path
  itself. Admin UI pages for this API are Issue #592, not this issue —
  "minimal UI... unless needed for verification" in the issue's own
  scope note was read as "API only", since the API itself IS the
  verification surface (curl/fetch), full UI is explicitly tracked
  separately.
- **Break-glass enforcement is at POLICY-SAVE time, not just login
  time** (issue's own acceptance criterion) — `saveTenantAuthPolicy`
  (`tenant-auth-policy.ts`) re-reads `break_glass_identity_ids` from the
  request against a FRESH DB query (`countEligibleBreakGlassIdentities`)
  confirming each id is a currently `active` identity with an `active`
  `awcms_tenant_users` membership — a request that would leave
  `sso_required=true` or `password_login_enabled=false` with zero
  eligible break-glass identities is rejected `409
BREAK_GLASS_REQUIRED` and never persisted. `login.ts` itself only
  enforces `password_login_enabled=false` when `isSsoRequired(env)` is
  ALSO active (`isPasswordLoginDisabledForIdentity`) — every
  local/offline/LAN deployment that never flips the #591 gate on runs
  zero extra queries and has zero behavior change, exactly like every
  other feature in this epic.
- **Auto-link by email, two independent fail-closed layers** (domain:
  `tenant-sso-policy.ts`'s `isAutoLinkAllowedForProvider`): the
  PROVIDER's own `allowed_email_domains` (mirrors
  `AUTH_GOOGLE_ALLOWED_DOMAINS`, per-tenant-per-provider instead of a
  deployment env var) AND the tenant POLICY's `auto_link_verified_email`
  master switch, which must be explicitly `true` — unlike Google (whose
  auto-link only needed the domain allow-list to be non-empty), generic
  SSO requires the tenant to opt in twice: enable the provider's own
  domain list AND flip the policy's master switch.
- `google-oidc-policy.ts`'s `evaluateOAuthRequest`/`validateIdTokenClaims`
  are reused VERBATIM here (imported directly, not copied) — both were
  already pure and provider-agnostic. `oauth-state-token.ts`'s
  `buildOAuthStateParam`/`parseOAuthStateParam`/`generateOAuthState`/
  `hashOAuthState`/`generateOidcNonce` are reused the same way. What is
  NOT reused: `google-oidc.ts`'s own `createOAuthRequest`/
  `consumeOAuthRequest`/`findIdentityByProviderSubject`/
  `linkProviderAccount`/`unlinkProviderAccount` all hardcode
  `provider = 'google'` in their SQL — `tenant-sso.ts` has its own small
  parameterized duplicates of these instead of refactoring Google's
  (keeps the already-tested Google flow untouched).
- Error code i18n: `error.sso_disabled`/`_provider_not_found`/
  `_provider_disabled`/`_provider_unavailable`/`_oauth_state_invalid`/
  `_token_exchange_failed`/`_id_token_invalid`/`_account_not_linked`/
  `_already_linked`/`_not_linked`/`_misconfigured`/
  `_provider_key_conflict`, plus `break_glass_required`/
  `password_login_disabled` (`error-messages.ts`, `i18n/en.po`+`id.po`).

### Admin policy UI (Issue #592)

`src/pages/admin/security.astro` + `src/lib/auth/auth-security-status.ts`
(pure env-only status aggregator, no DB/network I/O). Consumes #591's
existing admin CRUD API as-is — **no new API endpoint was added for this
issue**, and none was needed:

- SSR reads `getTenantAuthPolicy`/`listAuthProviders` (#591's own
  application-layer functions) directly inside the page's own
  `withTenant` transaction, same "call the application layer directly
  instead of round-tripping through this app's own HTTP API" convention
  `admin/settings.astro`/`admin/blog/settings.astro` already use.
  Mutations (policy save, provider create/update/delete) go through the
  REAL `PATCH /api/v1/identity/sso/policy` /
  `POST|PATCH|DELETE /api/v1/identity/sso/providers[/{id}]` endpoints via
  `sendJson`/`postJson` (`src/lib/ui/admin-form-client.ts`) — every mutation still runs
  through those endpoints' own ABAC + break-glass + audit logic; this
  page never writes to the database directly.
- **Two independent gates control what renders** (issue's own acceptance
  criteria): (1) the deployment gate `isFullOnlineSecurityActive(env)`
  (#587) — inactive on every local/offline/LAN deployment (the default),
  the page renders ONLY an informational hand-rolled `<p class="state-notice"
role="status">` notice (same inline pattern `offices.astro`/`roles.astro`
  use for their denied/error states) and nothing else, checked server-side
  in the page's own frontmatter BEFORE any of the status/policy/provider
  markup is generated — never just hidden with CSS; (2) ABAC
  (`identity_access.sso_policy.*`/`sso_providers.*`, migration 037, already
  seeded by #591) — gate active but neither permission held renders an
  access-denied `<p class="state-notice">` instead. Each section (policy
  form, provider table) additionally checks
  its OWN specific permission independently, same per-fieldset-permission
  convention `admin/access-users.astro` established.
- **Status summary never re-derives each feature's own gate** —
  `resolveAuthSecurityStatusSummary(env)` imports `isTurnstileEnabled`/
  `isMfaEnabled`/`isGoogleLoginEnabled`/`isSsoEnabled` plus each feature's
  own `*_REQUIRED_WHEN_ENABLED` env var name list
  (`TURNSTILE_REQUIRED_WHEN_ENABLED`, `AUTH_MFA_REQUIRED_WHEN_ENABLED`,
  `GOOGLE_OIDC_REQUIRED_WHEN_ENABLED`, `SSO_REQUIRED_WHEN_ENABLED`)
  directly from those features' own config modules rather than
  re-listing var names here — `configured: boolean` only ever reflects
  whether the required var(s) are PRESENT, never a value (issue's own
  security note: "Avoid leaking whether a provider credential exists
  beyond safe status flags such as `configured: true`").
- **Break-glass UX does not re-implement the eligibility check** — the
  form always shows the requirement inline next to `sso_required`/
  "disable password login", blocks an obviously-doomed submit
  client-side (zero break-glass identities selected at all) as a fast UX
  nicety, and always surfaces the server's authoritative
  `409 BREAK_GLASS_REQUIRED` rejection through the same translated
  error-message banner (`error.break_glass_required`, already in
  `error-messages.ts` since #591) every other mutation on the page uses.
  The break-glass identity picker itself needs `identity_access.user_management.read`
  (reused from `admin/access-users.astro`'s own guard) to render a
  checkbox list of tenant users; without it, the page falls back to a
  plain comma-separated-UUID text input so the form stays usable under
  least privilege rather than disappearing entirely.
- **Client secret fields are write-only** — never pre-filled or
  round-tripped from the API on the provider edit form, matching #591's
  own `AuthProviderView` never exposing `client_secret_ciphertext`.
- `identity_access`'s module descriptor (`module.ts`) now declares a
  `navigation` entry (`/admin/security`, `requiredPermission:
"identity_access.sso_policy.read"`) — the existing module-navigation
  registry (#518) renders it in the admin sidebar automatically; no
  `AdminLayout.astro` hardcoding needed, same pattern
  `tenant_domain`/`module_management`'s own descriptors already use.
- Playwright E2E specs (`tests/e2e/admin-security-disabled.e2e.ts`/
  `admin-security-enabled.e2e.ts`) log in through the REAL `/login` form
  (fill + submit + wait for the `/admin` redirect), not
  `page.request.post("/api/v1/auth/login")` — empirically, in this
  environment, a SUCCESSFUL login's `Set-Cookie` response headers going
  through Playwright's `page.request` API (as opposed to a real
  navigation/form submit) intermittently broke every subsequent
  `page.request`/`page.goto` call with an unrelated-looking `TypeError:
"<path>" cannot be parsed as a URL.` — reproduces even with a fully
  qualified absolute URL string, only after a 200 response carrying
  `Set-Cookie`; a failed login attempt (401/403, no cookie) never
  reproduces it. Root cause not fully isolated (did not reproduce from
  `Bun.spawn`, `Bun.SQL`, or `Bun.password.hash` in isolation, only their
  combination through a specific call path) — logged here so a future
  issue that needs `page.request` for an authenticated flow in this repo
  doesn't have to re-discover it from scratch; driving the real login
  form sidesteps the whole class of that bug and is arguably the more
  faithful "browser E2E" exercise anyway. Both specs seed an isolated
  owner/tenant fixture directly via SQL (`tests/e2e/helpers/seed-owner-tenant.ts`,
  run in a SEPARATE `bun` subprocess via `seed-owner-tenant-cli.ts` —
  keeping the argon2/Postgres work out of the same process that drives
  Playwright regardless of the exact trigger above) rather than
  `POST /api/v1/setup/initialize`, which is a once-only singleton-locked
  endpoint (`awcms_setup_state`) almost always already claimed on
  any long-lived dev database.

## Cross-issue rules that must be followed (#588-#593)

1. **Every feature (#588-#592) MUST call `isFullOnlineSecurityActive(env)`
   before doing anything online/provider-related** — do not check
   `AUTH_ONLINE_SECURITY_ENABLED`/`_PROFILE` directly or build your own
   gate. This gate being inactive must mean: no
   Cloudflare/Google/OIDC call whatsoever, no MFA challenge, and the login
   form stays exactly as it is today.
2. **`AUTH_ONLINE_SECURITY_ENABLED=false`/unset must never
   require any provider credential** — the default `.env.example` and
   every offline/LAN deployment that never touches the
   `AUTH_ONLINE_SECURITY_*`/`AUTH_SSO_*`/`AUTH_MFA_*`/`AUTH_GOOGLE_*`/
   `TURNSTILE_*` vars must still `config:validate` PASS and behave
   identically to before this epic existed.
3. **`APP_ENV=production` is NOT equivalent to full-online** — an
   offline/LAN deployment can be production-grade operationally (see
   `deployment-profiles.md`) without ever activating this gate. Never
   make `APP_ENV=production` a proxy for
   `isFullOnlineSecurityActive`.
4. **Local password login is never removed/disabled by
   default** by any feature in this epic — `sso_required`/
   `password_login_enabled=false` (#591, `awcms_tenant_auth_policies`)
   may only become active if there is a valid break-glass local owner/account,
   checked server-side (`saveTenantAuthPolicy`) before that policy can be
   saved — already implemented concretely, see §Generic tenant
   OIDC SSO provider above.
5. **Provider credentials (Google client secret, OIDC client secret,
   Turnstile secret key, TOTP seed, recovery codes) are never
   stored in plaintext** — either from an environment variable/secret manager, or
   encrypted at-rest with a key from the environment (`AUTH_SSO_CREDENTIAL_ENCRYPTION_KEY`/
   `AUTH_MFA_SECRET_ENCRYPTION_KEY`, etc.) — never appearing in an
   API response, a log, or audit attributes (`awcms-sensitive-data`).
6. **Linking/unlinking a provider account, auth policy changes, MFA
   enroll/disable, and recovery code regeneration are all high-risk actions** — they must be
   audited (`awcms-audit-log`) and idempotent if they are mutations
   (`awcms-idempotency`).
7. **The stable provider identifier is `sub` (the OIDC subject), not the
   email** — auto-link by email must require a verified email +
   an explicit allowed-domain policy, never implicit linking
   purely from an email string match. Already implemented concretely in
   #590 (`isEmailDomainAllowed`, fail-closed) AND #591 (generic tenant
   OIDC SSO, `isAutoLinkAllowedForProvider` — two layers: a PER-PROVIDER
   domain allow-list plus the `auto_link_verified_email` master switch in the
   tenant policy).
8. **All external provider calls (OIDC discovery/JWKS, Turnstile
   siteverify, Google token exchange) must be timeout-bounded AND their circuit
   breaker may only trip on genuine transport failures** — the same
   pattern as `cloudflare-dns-adapter.ts`/`mailketing-provider.ts`/
   `turnstile.ts`/`google-oauth-client.ts` (`withTimeout`, the
   `getProviderCircuitBreaker` circuit breaker), and never called
   inside a DB transaction (ADR-0006). Do NOT treat a valid 4xx response
   (attacker-controlled input correctly rejected by the provider) as a
   provider failure — the lesson from the Turnstile bug in PR #596, repeated
   correctly in #590's `exchangeAuthorizationCode`. **The same rule
   applies to the built-in DATABASE breaker** (`getDatabaseCircuitBreaker()`,
   used by `withTenant` for ALL endpoints/tenants, not just one
   provider) — an unauthenticated endpoint MUST NOT perform an
   INSERT/UPDATE with an FK to a tenant-scoped table using a `tenantId` whose
   existence has not been validated; an exception (e.g. a foreign-key
   violation) from attacker-controlled input will be caught by
   `withTenant`'s catch-all and trip this application-wide breaker —
   a blast radius FAR bigger than any per-provider breaker
   (the PR #598 lesson, see §Google OIDC login above). Always
   `SELECT` (safe, does not throw for an empty row) before an
   FK-carrying write on an endpoint reachable without authentication.
9. **New tenant-scoped tables (`awcms_identity_provider_accounts`,
   `awcms_oidc_auth_requests` — #590; `awcms_auth_providers`,
   `awcms_tenant_auth_policies` — #591; `awcms_identity_mfa_factors`
   et al. — #589) must have RLS `ENABLE` + `FORCE`** — the same pattern as every
   migration since 013 (`awcms-new-migration`).
10. **An MFA password reset must not become an MFA bypass** — a successful
    password reset does not automatically disable that identity's MFA.

## Epic closer — in micro vs here

> **Every sub-section below is the epic-closing note from
> awcms-micro** (closed there on 2026-07-10). Kept because the list of
> residual gaps it found applies generally. **Its paths, migration numbers, and
> issue numbers do NOT apply in awcms** — see §Map to the real awcms artifacts.
>
> The equivalents in awcms: the gate + Turnstile (#186), MFA/TOTP (#184, `sql/024`),
> generic OIDC/SSO + admin CRUD (#185, `sql/025`/`026`, endpoints
> `/api/v1/auth/sso/*` and `/api/v1/auth/sso-providers`), the admin policy UI
> (#274, `src/pages/admin/security.astro`). **Google-specific OIDC
> (`/api/v1/auth/providers/google/*`) DOES NOT EXIST in awcms** and that is
> a deliberate decision — do not conclude otherwise from any paragraph below.

The closing audit notes (micro) — the concrete gaps it found:

- `docs/awcms/18_configuration_env_reference.md` and
  `deployment-profiles.md` previously still said "#592-#593 are still
  backlog" even though #592 (admin policy UI) had already merged — fixed (a stale
  doc, found by this #593 audit, not hypothetical).
- `docs/awcms/20_threat_model_security_architecture.md` previously
  mentioned Turnstile/MFA/Google OIDC/SSO/break-glass ZERO times —
  a §Additional standards triggered by the full-online auth security
  hardening epic (Issue #587-#593) was added, mapping the seven risk categories
  this issue explicitly asked for (credential stuffing, bot abuse, OIDC
  callback abuse, provider outage, MFA recovery abuse, SSO lockout,
  offline dependency breakage) onto the concrete evidence that already exists.
- `scripts/security-readiness.ts` added `checkSsoBreakGlassReady`
  (critical) — the residual gap already noted above (§Generic
  tenant OIDC SSO provider): `saveTenantAuthPolicy` only validates
  break-glass eligibility at SAVE time; a break-glass identity can be
  deactivated (or its tenant membership revoked) BY SOME OTHER ACTION
  afterwards without that policy itself ever being saved again. This new check
  RE-verifies every active tenant's eligibility from the DB at
  readiness/go-live time, reusing `countEligibleBreakGlassIdentities`
  (now exported from `tenant-auth-policy.ts`) — not a second rule that
  could diverge. Different from Issue #605 (break-glass picker/data-hygiene
  UX in the admin form), which was left open as a separate issue —
  this readiness check audits the DB, not the form UX.
- `.env.example`, `scripts/validate-env.ts`, the OpenAPI
  (`openapi/awcms-public-api.openapi.yaml`), and
  `src/modules/identity-access/README.md` were already accurate as of #587-#591
  respectively — re-confirmed by #593, unchanged.

Issue #601 (SQLSTATE class 22 circuit-breaker exclusion), #605 (break-glass
picker/data-hygiene UX in the admin form), #603 (SSRF hardening for the
tenant-configured OIDC `issuer_url`), and #610 (additional hardening on top of
decision #603 — an aggregate per-`providerKey` rate limit + negative-TTL cache) are
**done** as separate follow-ups after #593 (see §Break-glass
picker/data-hygiene below for #605, and §SSRF/`issuer_url` —
the accepted-risk decision for #603, including #610's hardening in that
same sub-section).

### SSRF/`issuer_url` — the accepted-risk decision (Issue #603, done)

**Decided NOT to add an IP-range denylist** (resolve the hostname, reject
private/loopback/link-local/metadata-endpoint) for the tenant-configured
OIDC `issuer_url` (#591). This is the ONLY outbound URL in this base that
comes from tenant-configured data, not from trusted server env (unlike
every other provider — R2, Mailketing, Cloudflare DNS/Turnstile — which are
all SSRF-safe by convention: the URL always comes from `process.env`).

**Why it is NOT blocked — corrected after the PR #609 security audit** (the
first version of this decision wrongly cited LAN-first/offline as the reason;
in fact this generic SSO feature is ONLY active in the `full_online` profile
(`isFullOnlineSecurityActive`) — the OPPOSITE of LAN-first/offline, which
never loads this code at all because its gate is not active).
The correct reason: a `full_online` (cloud/registry) deployment still often
needs to connect to a tenant's enterprise IdP hosted on-prem and
only reachable over a VPN/private tunnel — the "bring-your-own-IdP" pattern
common in multi-tenant SaaS products (WorkOS, Auth0 Enterprise Connections,
etc. — NOT Okta/Auth0/Azure AD themselves as the IdP, which is not the right
analogy because AWCMS here acts as the relying party that
calls a third-party issuer, not as the IdP). A blanket private-IP
block would break this enterprise-IdP-over-VPN scenario.

**The actual limit of the mitigation (corrected)** — IMPORTANT, do not assume
the exploitation risk is closed: the ABAC gate
(`identity_access.sso_providers.create`/`update`) and the audit log ONLY
constrain who can CONFIGURE a malicious `issuer_url`. Neither
constrains who can TRIGGER the outbound fetch once the provider is
configured — `GET /api/v1/auth/sso/{providerKey}/start`, which triggers
`discoverOidcConfiguration`, is unauthenticated, only rate-limited
per-source+tenant (not per-`providerKey`), and the discovery cache is only
filled on a SUCCESSFUL request — an internal target that never answers with
valid OIDC JSON is never cached, so this public endpoint can be
used to probe repeatedly without any real limit. This is a residual risk
accepted TOGETHER WITH the main decision, not a gap already closed by
ABAC — operator-level network segmentation for genuinely sensitive
internal services remains the real line of defence, not ABAC.

**Follow-up — done (Issue #610)**, revised after TWO rounds of security
review:

- **A Critical fix, actually a pre-existing bug since #591**: ALL the
  caches/circuit-breakers in `generic-oidc-client.ts`
  (`discoveryCache`/`jwksCache`, the discovery/jwks/token breakers) were
  previously keyed ONLY by `providerKey`. `provider_key` is only unique PER TENANT
  (migration 036's unique index is `(tenant_id, provider_key)`), so
  two different tenants that both name their provider `"okta"`
  (very common) SHARE the same cache/breaker entry — a malicious tenant admin
  could register a provider with a common vendor slug whose `issuer_url`
  points at the attacker's server, trigger a single fetch, and have that
  attacker's `authorization_endpoint`/`jwks_uri` served to ANOTHER tenant
  that has a real `"okta"` provider — not merely an availability leak, but a
  cross-tenant SSO takeover primitive (redirect to phishing + a forged ID token
  that passes verification against the attacker's own JWKS). Fixed:
  `discoverOidcConfiguration`/`fetchProviderJwks`/`exchangeAuthorizationCode`
  now take a `tenantId` and key every cache/breaker with
  `${tenantId}:${providerKey}` (`scopedProviderKey`). Tests:
  `tests/unit/generic-oidc-client.test.ts`'s "CRITICAL: two DIFFERENT
  tenants using the SAME providerKey..." and
  `tests/integration/tenant-sso-flow.integration.test.ts`'s "CRITICAL: two
  DIFFERENT tenants both naming their provider 'okta'...".
- **A design correction — the first draft of this PR added a new bug**: the
  first draft added an AGGREGATE (not per-source) rate limit in `start.ts`, keyed
  `${tenantId}:${providerKey}`, to constrain a prober rotating
  source IPs. The SECOND security-auditor round found that this SHARED budget
  is itself a DoS vector requiring no privilege at all: anyone, from
  as few as 3 source IPs, can exhaust the whole budget and lock
  ALL of that tenant's legitimate users out of SSO login for the rate-limit
  window, repeatedly — the test the first draft added to prove this
  mechanism accidentally PROVED that DoS instead. This aggregate rate
  limit was **removed entirely**. The real defence against sustained
  probing is the circuit breaker (now genuinely scoped to
  tenant+provider) + the negative-TTL cache below — both of which ONLY
  limit FAILED attempts, so they can never block a legitimate login
  to a healthy provider, unlike a shared HTTP-level rate limit that
  blocks every request regardless of outcome.
- A negative/short-TTL cache (`NEGATIVE_CACHE_TTL_MS = 30s`,
  `discoveryFailureCache`/`jwksFailureCache` in `generic-oidc-client.ts`,
  now keyed `${tenantId}:${providerKey}`) for FAILED discovery/JWKS
  attempts — a target that never answers with valid JSON no longer
  triggers a fresh fetch on every hit, only once per 30-second window.
- The infra-layer recommendation to block egress to `169.254.169.254` (the cloud
  metadata endpoint) specifically for `full_online` deployments is documented in
  `deployment-profiles.md` §Generic tenant OIDC SSO (a residual that stays
  outside the application's scope — the operator's responsibility, not the code's).
  **Follow-up — done (Issue #612)**: without a cap, a malicious tenant admin could
  register many `awcms_auth_providers` rows (each getting its own
  independent cache/breaker budget, correctly scoped since
  #610) to multiply the total probing volume linearly with the
  number of rows. Fixed with the `AUTH_SSO_MAX_PROVIDERS_PER_TENANT` cap
  (default 20) in `createAuthProvider` (`auth-provider-directory.ts`) —
  `POST /api/v1/identity/sso/providers` rejects with
  `409 SSO_PROVIDER_LIMIT_EXCEEDED` as soon as the tenant's active (non-soft-
  deleted) row count reaches the limit. Count-then-insert, deliberately NOT atomic
  (`SELECT ... FOR UPDATE`) — this bounds a probing budget, not a
  security invariant like MFA replay (§MFA/TOTP above), so a small
  overshoot from concurrent creates is harmless for what this mechanism
  prevents.

**If stricter SSRF hardening is needed in the future** (e.g. a purely SaaS
`full_online` operator that does not need an on-prem IdP at all): do not
blanket-block — add it as a per-deployment opt-in (a separate env var,
default off) so that the enterprise-IdP-over-VPN scenario never silently
regresses. Do not reimplement this decision without reading the
rationale above first.

### Break-glass picker/data-hygiene (Issue #605, done)

Follow-up from the PR #604 (#592) security-auditor review — two non-blocking
UX gaps (not a security bypass; `saveTenantAuthPolicy` always remains the
authoritative control) were fixed:

- **The `admin/security.astro` checkbox picker now filters candidates to
  `tenant_user.status === 'active' && identity.status === 'active'`**
  before rendering — previously it showed ALL tenant users (including
  suspended/inactive ones) as break-glass options, so an admin
  could pick an identity that the server would obviously reject and only find out
  after submitting. `fetchTenantUsersWithRoles` (shared with
  `admin/access-users.astro`) itself was NOT changed — the filter is at the
  point of use (`security.astro`), not in the shared query.
- **`saveTenantAuthPolicy` now filters the `break_glass_identity_ids`
  it PERSISTS down to only the ids confirmed eligible** by
  `fetchEligibleBreakGlassIdentityIds` (a new function — `countEligibleBreakGlassIdentities`
  is now a thin wrapper over it, and `scripts/security-readiness.ts`'s
  `checkSsoBreakGlassReady` is unchanged because its count signature is the
  same), instead of storing the submitted list as-is. Previously,
  submitting "1 valid id + N junk/typo ids" (e.g. through the manual
  free-text fallback picker for admins without `user_management.read`,
  or a direct API call) would store ALL the ids including the
  junk, even though only one of them ever determined the save's outcome. Regression
  test: `tests/integration/tenant-sso-flow.integration.test.ts`'s
  "break-glass hygiene: saving policy with 1 valid + N garbage/ineligible
  ids persists ONLY the valid one".
