🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](05-kontrak-sesi-dan-bff.id.md)

# 05 — Cross-origin session contract and the BFF

> Plan. See the [README](README.md) for status. The session introspection
> endpoint **does not exist yet** in this repo.

## 1. What already exists (and is often misread)

| Fact in the code                                                                                                                                 | File                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Login returns a token **and** sets two httpOnly cookies: `awcms_session` + `awcms_tenant_id` (`SameSite=Lax`, `Secure` via `AUTH_COOKIE_SECURE`) | `src/pages/api/v1/auth/login.ts`, `src/lib/auth/ssr-session.ts`        |
| The guard accepts a **bearer header + tenant header OR a cookie** — the header wins, the cookie is the fallback                                  | `resolveAuthInputs()` in `identity-access/application/access-guard.ts` |
| `GET /api/v1/auth/me` accepts **bearer only**                                                                                                    | `src/pages/api/v1/auth/me.ts`                                          |
| Sessions are stored as a token hash, can be revoked; MFA/step-up raises assurance and **rotates** the session                                    | the `identity_access` module                                           |

The correct conclusion: what is missing is not "cookie support" but a **session
contract for a different origin**. The `awcms_session` cookie belongs to the
`awcms` origin; a browser on `jualanku.info` will never send it, and must not.

## 2. The agreed shape

```
Browser  ──httpOnly cookie "jualanku_portal"──►  awcms-astro (BFF)
                                                   │  holds the mapping
                                                   │  portal cookie → awcms session token
                                                   │  (server-side, never reaches the client)
                                                   ▼
                                        awcms  /api/v1/auth/session (introspection)
                                        awcms  /api/v1/jualanku/portal/**
```

- The browser **never** holds an `awcms` token.
- The BFF sends the token as `Authorization: Bearer` + `x-awcms-tenant-id` to
  `awcms` over the private network.
- The tenant is derived by the BFF from the deployment/host configuration
  (`tenant_domain`), never from user input.

## 3. The introspection endpoint that must be added

`GET /api/v1/auth/session` — owner: `identity_access`.

- **Input:** bearer token + tenant header (called by the BFF, not by the browser).
- **Output (safe claims only):** `identityId`, `tenantId`, `displayName`,
  `roles[]`, `assuranceLevel` (aal1/aal2), `expiresAt`, `scopes[]` (references to
  the active merchant/affiliate scopes).
- **Never returned:** the token, the token hash, password status, MFA secrets,
  recovery codes, raw email/phone, or any attribute the portal header does not
  need.
- **Fail-closed & anti-oracle:** an invalid/expired/revoked session produces one
  and the same response shape (401 `AUTH_REQUIRED`), without distinguishing
  "does not exist" from "expired".
- Rate-limited, never cached (`no-store`).

The **rejected** alternative: letting the public browser call `/api/v1/**`
directly with cross-site cookies. That moves tenant selection, CSRF, and CORS
onto the client.

## 4. BFF obligations

| Requirement           | Rule                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Portal cookie         | `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict` if the login flow needs no cross-site redirect), `Path=/`.                                   |
| Token storage         | The `awcms` token is kept server-side (the BFF session store) or inside an encrypted cookie — **never** in JS.                                 |
| CSRF                  | An Origin/Referer check **plus** a double-submit/synchronizer token for every mutation. Not just one of them.                                  |
| Tenant                | Set by the server from the host mapping; a tenant header from the client is ignored entirely.                                                  |
| Logout                | Call the `awcms` logout (revocation at the source of truth) **first**, then delete the portal cookie. The reverse order leaves a live session. |
| Rotation              | After login, after a step-up/privilege change, and after recovery. Rotation prevents session fixation.                                         |
| Revocation            | The source of truth stays `awcms`. The BFF keeps no session list of its own and does not "remember" a session that has been revoked.           |
| Cache                 | `Cache-Control: private, no-store` for every portal and `_portal-api` response.                                                                |
| Errors                | The `awcms` envelope is translated into a view model; the `correlationId` is forwarded into the logs on both sides.                            |
| Timeout & degradation | `awcms` unavailable → an honest error page, not a blank page that looks like a success.                                                        |

## 5. Condensed threat model

| Threat                                         | Control                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Token theft via XSS in the portal              | The token is never in JS; strict CSP; no `set:html` from any source other than a controlled renderer |
| CSRF on portal mutations                       | Origin check + CSRF token + `SameSite`                                                               |
| Session fixation                               | Session rotation after login/step-up                                                                 |
| Confused deputy (the BFF used as a free proxy) | The BFF only has an explicit list of upstream routes; there is no generic path passthrough           |
| Tenant tampering                               | The tenant is server-derived; a client tenant header is ignored                                      |
| Private data leaking into a cache/sitemap      | `no-store` + private routes never enter the sitemap + the cache surface gate                         |
| Account/merchant enumeration                   | Uniform responses; anti-oracle 404; rate limits on login and lookup                                  |
| Mutation replay                                | An idempotency key on high-risk actions                                                              |

## 6. Tests that must accompany this contract

1. Valid session → introspection returns only the safe claims (test field by
   field: a newly leaked field must turn the test red).
2. Revoked/expired session → 401 with an identical response shape.
3. A mutation without a CSRF token → rejected; with a foreign Origin → rejected.
4. A tenant header from the client is ignored (send a different tenant → it stays
   the host's tenant).
5. Portal logout → the `awcms` session really cannot be used again.
6. An MFA step-up mutates assurance and **rotates** the token; the old token dies.
7. A portal response never carries a `Cache-Control` that allows shared caching.
