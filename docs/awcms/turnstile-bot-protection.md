🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](turnstile-bot-protection.id.md)

# Cloudflare Turnstile — deployment-profile-aware bot protection

Implementation reference for Issue #186 (epic #177). Modules: `identity-access` (login path) + `tenant-admin` (setup). ADR: [ADR-0029](../adr/0029-deployment-profile-aware-turnstile-bot-protection.md). **No migration** — Turnstile is purely configuration/env; there are no new tables/columns and the secret never touches the DB.

The feature is active **only** when the deployment profile is full-online AND `TURNSTILE_ENABLED=true`. Every LAN/offline deployment (the default) renders the login page byte-identical to how it was before this feature: no widget, no iframe, no Cloudflare CSP origin, no outbound verification call.

Turnstile is a layer **on top of** rate limiting, lockout, audit, and the generic authentication error — not a replacement. Rate limit + lockout keep working independently of Turnstile.

## 1. Activation gate

One function decides everything: `isTurnstileRequired(env)` (`src/lib/security/turnstile.ts`):

```
isTurnstileRequired = isFullOnlineSecurityActive(env) && TURNSTILE_ENABLED === "true"

isFullOnlineSecurityActive = AUTH_ONLINE_SECURITY_ENABLED === "true"
                          && AUTH_ONLINE_SECURITY_PROFILE === "full_online"
```

| Profile                        | `AUTH_ONLINE_SECURITY_*`     | `TURNSTILE_ENABLED` | Result                                         |
| ------------------------------ | ---------------------------- | ------------------- | ---------------------------------------------- |
| LAN/offline (default)          | unset / `false`              | anything            | **OFF** — no widget/CSP/outbound               |
| LAN with the Turnstile flag on | `false` / profile `disabled` | `true`              | **FULLY OFF** (the profile gate wins)          |
| Full-online, Turnstile off     | `true` + `full_online`       | `false` / unset     | OFF (staging the credentials first is allowed) |
| Full-online, Turnstile on      | `true` + `full_online`       | `true`              | **ACTIVE** — fail-closed enforcement           |

The widget (`login.astro`), the CSP origin (`security-headers.ts`), and the enforcement (`login.ts`/`initialize.ts`) are all gated by the same function, so drift is impossible (e.g. the CSP opened but the widget not rendered).

## 2. Configuration / env reference

All vars are optional; the LAN/offline default passes `config:validate` without a single one of them set. See `.env.example`.

| Var                            | Type                           | Default    | Notes                                                                                                                                           |
| ------------------------------ | ------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_ONLINE_SECURITY_ENABLED` | bool                           | `false`    | Master gate for the full-online profile.                                                                                                        |
| `AUTH_ONLINE_SECURITY_PROFILE` | enum `disabled`\|`full_online` | `disabled` | `full_online` is required when the gate is on.                                                                                                  |
| `TURNSTILE_ENABLED`            | bool                           | `false`    | Turnstile feature flag.                                                                                                                         |
| `TURNSTILE_SITE_KEY`           | string (**public**)            | —          | Site key; embedded in the widget. **Not** a secret. Required when enabled.                                                                      |
| `TURNSTILE_SECRET_KEY`         | string (**secret**)            | —          | Server-side siteverify secret. Never goes to the client/log/audit/DB. Required when enabled.                                                    |
| `TURNSTILE_EXPECTED_HOSTNAME`  | string                         | —          | The public hostname the widget is served on; a token from another hostname is rejected. Required when enabled (fail-closed hostname-confusion). |
| `TURNSTILE_VERIFY_TIMEOUT_MS`  | int > 0                        | `5000`     | Siteverify timeout (spanning the fetch + reading the body).                                                                                     |
| `TURNSTILE_MAX_TOKEN_AGE_SEC`  | int > 0                        | `300`      | `challenge_ts` freshness window.                                                                                                                |
| `TURNSTILE_MAX_RESPONSE_BYTES` | int > 0                        | `16384`    | Cap on the siteverify response size.                                                                                                            |

**Cross-rule preflight** (`bun run config:validate`):

- `AUTH_ONLINE_SECURITY_ENABLED=true` requires `AUTH_ONLINE_SECURITY_PROFILE=full_online` — this is what distinguishes **misconfigured** from **disabled intentionally**.
- `TURNSTILE_ENABLED=true` requires non-empty `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME` (independent of the profile gate, so credentials can be staged first).

`bun run security:readiness` adds two named checks — `checkOnlineAuthSecurityReady` and `checkTurnstileReady` — critical when misconfigured, informational-pass when disabled-intentionally, and they **never print a secret value** (only the name of the missing var).

## 3. Auth flow (login flow)

```
Client (login.astro)                    Server (login.ts)                 Cloudflare
────────────────────                    ─────────────────                 ──────────
[widget cf-turnstile] --solve-->
  hidden cf-turnstile-response
POST /auth/login {..,turnstileToken} -->
                                        1. check tenant header
                                        2. rate limit (source+tenant)
                                        3. validate body shape
                                        4. enforceTurnstileIfRequired ------ siteverify -->
                                           (BEFORE withTenant & password)   <-- success/action/
                                                                                 hostname/ts
                                           - required?  no → continue (LAN)
                                           - token missing → 400 TURNSTILE_REQUIRED
                                           - invalid/mismatch/outage → 400 TURNSTILE_INVALID
                                        5. withTenant → identity lookup
                                        6. verifyPasswordOrDummy (argon2id)
                                        7. deny-block → break-glass branch (#185)
                                           → MFA branch (#184) → session
```

The ordering is the key: Turnstile runs **after** the rate-limit/request-shape checks, **before** the expensive password work and **outside** the DB transaction — it precedes the MFA & OIDC break-glass branches without regressing them. Because it runs before the identity lookup, a Turnstile failure is never an account-enumeration oracle (identical response for known/unknown identifiers).

Setup (`POST /api/v1/setup/initialize`) follows the same pattern with the `setup` action (a login token cannot be reused here). This base has no setup UI page, so setup enforcement is a defence for the operator running bootstrap on a full-online deployment.

## 4. Cloudflare setup & secret rotation

**Provisioning:**

1. Cloudflare dashboard → Turnstile → Add Site. Domain = the deployment's public hostname (e.g. `app.example.com`). Widget mode as needed (managed recommended).
2. Copy the **Site Key** → `TURNSTILE_SITE_KEY` (public, may be committed to non-secret env config). Copy the **Secret Key** → `TURNSTILE_SECRET_KEY` (secret manager, **do not** commit).
3. Set `TURNSTILE_EXPECTED_HOSTNAME` = the same public hostname as the widget's domain.
4. (Optional) Setting an `action` per widget in the dashboard is not needed — this base sends `data-action="login"` and validates its echo server-side.
5. Turn it on: `AUTH_ONLINE_SECURITY_ENABLED=true`, `AUTH_ONLINE_SECURITY_PROFILE=full_online`, `TURNSTILE_ENABLED=true`.
6. Run `bun run config:validate` then `bun run security:readiness` — both must be green before go-live.

**Secret Key rotation (zero-downtime):**

1. Cloudflare dashboard → widget → rotate secret. Cloudflare accepts the old **and** the new secret for a short transition period.
2. Update `TURNSTILE_SECRET_KEY` in the secret manager → rolling-restart the instances. Because verification is stateless (no state in the DB), there is no migration/backfill.
3. Validate a successful login on one instance, then finish the rollout.
4. The site key is rarely rotated; if it is replaced, update `TURNSTILE_SITE_KEY` (redeploy so the widget carries the new key) at the same time.

The secret is **never** stored in the DB/source/log/audit — only in env/the secret manager. A DB backup never yields a Turnstile secret.

## 5. Incident / fallback SOP (Turnstile unavailable)

On the full-online profile, a Cloudflare failure is **fail-closed**: login/setup are rejected with `TURNSTILE_INVALID` for the duration of the outage (the `turnstile` circuit breaker opens after consecutive transport failures and rejects fast). This is deliberate — not a bug.

Mitigation options, safest first:

1. **Wait for recovery.** The breaker retries automatically after `openDurationMs`. The `turnstile.circuit_breaker_open` log (warning) marks an ongoing outage.
2. **Temporarily downgrade the profile** if the Cloudflare outage drags on and admin access is critical: set `TURNSTILE_ENABLED=false` (or `AUTH_ONLINE_SECURITY_ENABLED=false`) → rolling-restart. Rate limit + lockout **still** protect login. Restore it once recovered. Record the decision in the operational audit.
3. **Do not** disable rate limit/lockout as "compensation" — that removes exactly the layer that still works.

Admin break-glass (OIDC #185) and lockout do not depend on Turnstile; the local password path for a break-glass identity remains subject to rate limit + Turnstile (if still enabled) — turn the flag off if you are genuinely locked out by a provider outage.

## 6. Threat model

| Threat                                          | Mitigation in this base                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bot abuse / credential stuffing**             | Cloudflare managed widget + server-side verification before the argon2id verify; layered with the source+tenant rate limit and per-principal lockout (ADR-0086 — one counter per human, across all tenants; rotating `x-awcms-tenant-id` no longer multiplies the attempts).     |
| **Token replay (across requests)**              | Cloudflare makes the token single-use (a second verify → `success:false` → rejected). The verifier also checks `challenge_ts` freshness (`TURNSTILE_MAX_TOKEN_AGE_SEC`). Turnstile runs before the idempotency layer and never touches its store → it cannot bypass idempotency. |
| **Token replay (across actions)**               | The `action` is validated per endpoint (`login` vs `setup`); a token solved for login is rejected at setup. A mutation test proves it (remove the action check → the test goes red).                                                                                             |
| **Fail-open**                                   | Every failure (misconfig/outage/timeout/malformed/mismatch/stale) collapses into a `TURNSTILE_INVALID` rejection. A runtime misconfig (enabled without secret/hostname) is fail-closed, not skipped.                                                                             |
| **Hostname confusion**                          | The response `hostname` is validated against `TURNSTILE_EXPECTED_HOSTNAME` (required when enabled). A token solved on an attacker page that embeds our site key is rejected. A mutation test proves it.                                                                          |
| **Provider outage → mass cross-tenant lockout** | The circuit breaker only trips on **transport** failures; `success:false`/mismatch counts as a provider success, so garbage tokens cannot lock out login for every tenant.                                                                                                       |
| **Account enumeration oracle**                  | Enforcement runs before the identity lookup; every failure gets a single generic code; the token/secret never appear in a response/log/audit.                                                                                                                                    |
| **Secret exposure**                             | The secret comes from env only; never in the DB/source/log/audit/response/health output (readiness prints only the var name). Defense-in-depth redaction on the verifier's error messages.                                                                                       |
| **SSRF via the verify endpoint**                | The siteverify URL is fixed (`config.verifyUrl` comes only from configuration, never from request input).                                                                                                                                                                        |
| **DoS via a large response**                    | A response size cap (`TURNSTILE_MAX_RESPONSE_BYTES`) + a single-`AbortController` timeout covering both the fetch and reading the body (anti slow-drip).                                                                                                                         |

## 7. Testing

- `tests/turnstile-verifier.test.ts` — the verifier against a fake siteverify (`Bun.serve`): success, reject, timeout, malformed, non-2xx, oversize, breaker open, hostname/action/stale mismatch (mutation proofs), and that the token/secret never leak into logs/details.
- `tests/turnstile-enforcement.test.ts` — enforcement: LAN/disabled has **zero outbound** calls (spying on `globalThis.fetch`), full-online is fail-closed (missing/misconfig/reject/mismatch → one generic code), plus the preflight matrix LAN / full-online valid / full-online misconfigured (`validateEnv` + `checkTurnstileReady` + `checkOnlineAuthSecurityReady`).
- `tests/security-headers-csp.test.ts` — the CSP origin opens only when enabled, is narrowed to a single Cloudflare origin, and enabled vs disabled differ in **only** two directives.
