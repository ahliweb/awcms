🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0029-deployment-profile-aware-turnstile-bot-protection.id.md)

# ADR-0029 — Deployment-profile-aware Cloudflare Turnstile bot protection

- **Status:** Accepted
- **Date:** 2026-07-19
- **Decision makers:** maintainer
- **Related:** Issue #186, epic #177 (derived ERP foundation readiness); ADR-0027 (MFA/step-up), ADR-0028 (OIDC/SSO) — compatible & sequenced earlier on the login path; ADR-0026 (modular OpenAPI); doc `docs/awcms/turnstile-bot-protection.md`; port from awcms-mini Issue #587/#588 (adapted & hardened, not copied).

## Context

AWCMS supports LAN/offline-first deployment while also being runnable full-online. Public login and the setup endpoint on the full-online profile need extra bot mitigation (bots drive the expensive argon2id verify, credential stuffing, and races against tenant bootstrap), but a Cloudflare dependency **must not** block a LAN installation, local setup, or any operational flow when the feature is disabled.

Turnstile must be a control **layered on top of** rate limiting, lockout, audit, and the generic authentication error — not a replacement. awcms-mini already has a Turnstile slice (Issue #588), but (1) mini only checks `success` from siteverify (it does not validate `action`/`hostname`/freshness), and (2) it reads the response body outside the timeout timer (a slow-drip body can outrun the deadline). This base's login path is also **harder** than mini's (dummy argon2id, collapsed deny reasons, `TRUSTED_PROXY_ENABLED`, the #184 MFA branch + #185 OIDC break-glass) — a naive port could regress it.

## Decision

We decided to **port Turnstile from mini and harden it**, gated by the deployment profile:

1. **Deployment-profile gate (`src/lib/auth/online-security-config.ts`).** Unlike MFA (#184) and OIDC (#185), which in this base drop the profile concept and depend only on their own flag, Turnstile is a control that reaches out to Cloudflare and therefore **must** be inert on LAN/offline. `isFullOnlineSecurityActive(env)` is true only when `AUTH_ONLINE_SECURITY_ENABLED=true` **and** `AUTH_ONLINE_SECURITY_PROFILE=full_online`. This is what separates "disabled intentionally" (flag off — a legitimate LAN) from "misconfigured" (flag on but the profile is not `full_online`) in preflight.
2. **One gate function: `isTurnstileRequired(env) = isFullOnlineSecurityActive(env) && TURNSTILE_ENABLED==="true"`.** The widget, the CSP origin, and the outbound verification call are ALL gated by this function. Crucial consequence: `TURNSTILE_ENABLED=true` on a LAN profile → **still fully OFF** (no widget/iframe/CSP origin/outbound call).
3. **Server-side verification through a separate adapter (`src/lib/security/turnstile.ts`).** `verifyTurnstileToken` calls Cloudflare siteverify and validates `success`, **`action`** (per endpoint: `login` vs `setup` — one token cannot be used across actions), **`hostname`** (anti hostname-confusion), and **`challenge_ts` freshness** (anti stale replay). The timeout + response-size cap are driven by **a single `AbortController`** that spans both the fetch **and** the body read (closing mini's slow-drip hole). Zero DB access, never inside a transaction — it is called before `withTenant`, before password verify.
4. **Generic fail-closed on the profiles that require it.** Missing token → `TURNSTILE_REQUIRED`. Misconfig (enabled without a secret/hostname), provider outage/timeout, malformed response, hostname/action mismatch, or stale → ALL collapse to the single code `TURNSTILE_INVALID`. Because verification runs **before** any identity lookup, there is no account-enumeration oracle. Rate limiting + lockout keep working **independently** of Turnstile.
5. **Shared circuit breaker (`getProviderCircuitBreaker("turnstile")`).** Only transport failures (non-2xx, unparseable, timeout, network error) trip the breaker; `success:false` and hostname/action/freshness mismatches count as a **provider success** (an outcome an attacker can replay must not be able to lock login across tenants — the lesson of mini PR #596).
6. **Narrow CSP integration, only while active (`src/lib/security/security-headers.ts`).** When `isTurnstileRequired()`, the middleware opens **one** origin `https://challenges.cloudflare.com` in `script-src` (plus `'self'`) and `frame-src`. When inactive, the CSP is byte-identical to before this issue (no `script-src`/`frame-src`, no third-party origin). The builder remains the sole owner of the CSP (the reporting-path ADR: middleware, not `astro.config`).
7. **Conditional widget (`src/pages/login.astro`).** The `<div class="cf-turnstile">` + the `<script is:inline src="…cloudflare…api.js">` loader are rendered ONLY when `isTurnstileRequired()`. The loader is an explicit external script (not an Astro-bundled module, which would only be from `'self'`). `TURNSTILE_SITE_KEY` is public (Cloudflare puts it in the widget); `TURNSTILE_SECRET_KEY` is server-side only and never reaches the page.
8. **Endpoints wired up:** `POST /api/v1/auth/login` (action `login`) and `POST /api/v1/setup/initialize` (action `setup`). This base has no password reset/forgot route, so only these two public forms are wired. The optional `turnstileToken` request field is documented in OpenAPI (`api:spec:check`/`api:docs:check` green).
9. **Consistent preflight with no secret leakage.** `config:validate` (profile cross-rules + `TURNSTILE_*` required-when-enabled), `security:readiness` (`checkOnlineAuthSecurityReady` + `checkTurnstileReady`, both distinguishing disabled-intentionally from misconfigured and never printing a secret value), and `.env.example` are aligned. Secrets come from env, never from the DB/source/log/audit.
10. **Fake verifier for tests.** `config.verifyUrl` (from configuration, not from request input — SSRF-safe) allows a local fake siteverify (`Bun.serve`) in unit/integration tests without calling the real Cloudflare.
11. **The harder login path is preserved intact.** Turnstile enforcement is inserted AFTER the request-shape check + rate limiting and BEFORE `withTenant`/password — ahead of the MFA branch (#184) and the OIDC break-glass (#185). `resolveLoginPolicyConfig`/`verifyPasswordOrDummy` are untouched; none of mini's `Number(process.env…)` came along.

## Consequences

- **No migration.** Turnstile is pure config/env (identical to mini's decision) — no new table/column; the secret never touches the DB.
- **LAN/offline is completely unchanged.** Default `AUTH_ONLINE_SECURITY_ENABLED=false` → `isTurnstileRequired()` false → zero new behaviour, zero CSP origins, zero outbound calls (proven by a `globalThis.fetch` spy test asserting count 0).
- **The frozen OpenAPI snapshot** (`tests/fixtures/openapi-pre-migration-snapshot.openapi.yaml`) IS STILL UNTOUCHED — the pre-#182 snapshot must stay frozen. The optional `turnstileToken` field on the two pre-migration paths (`/auth/login`, `/setup/initialize`) is acknowledged through the `INTENTIONALLY_EVOLVED_PATHS` allow-list in the contract-equivalence test (`tests/openapi-bundle.test.ts`): a listed path need not be byte-identical, but its frozen contract must remain a **strict subset** of the current contract (checked by `isAdditiveSuperset` — every old field is preserved, only additions are allowed). Removing a field OR turning an optional field into a `required` one still REDDENS the test. Editing the snapshot is forbidden (it would make the test compare the bundle against a copy of itself).
- **Residual (accepted, documented in the threat model):** hostname verification depends on a single `TURNSTILE_EXPECTED_HOSTNAME` (a multi-hostname deployment needs adjustment); freshness depends on the server clock; DNS-rebinding to siteverify is irrelevant (the URL belongs to Cloudflare and is not input). Single use of the token is enforced by Cloudflare (a second verify → `success:false`), so it cannot bypass idempotency (Turnstile runs before the idempotency layer and never touches its store).

## Rejected alternatives

- **Matching the MFA/OIDC pattern (flag only, no profile).** Rejected: a control that reaches Cloudflare must be genuinely dead on LAN; the deployment profile is the core of issue #186's request ("deployment profile applicability", "fully OFF on LAN").
- **Copying mini's verifier as-is.** Rejected: mini does not validate action/hostname/freshness and reads the body outside the timer — it does not meet #186's security requirements.
- **Trusting the client widget response as the final result.** Explicitly rejected by the issue — verification must be server-side.
- **Putting Turnstile inside the DB transaction / after password verify.** Rejected: external providers stay outside the transaction (ADR-0006), and a bot gate must come before the expensive work.
- **Different error codes for misconfig/mismatch/outage.** Rejected: that would be an oracle for an unauthenticated caller — everything collapses to `TURNSTILE_INVALID`.
