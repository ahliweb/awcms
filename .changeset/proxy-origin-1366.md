---
"awcms": patch
---

fix(http): behind a proxy `Astro.url.host` is the listener's `localhost:<port>` (Astro 7 trusts Host only for `security.allowedDomains`, left unset on purpose because it would also make Astro accept a client-sent `X-Forwarded-For` as `clientAddress`). New `resolveRequestHost` and `declaredSiteHost` in `src/lib/http/site-origin.ts`: a loopback request host is replaced by the host of `APP_URL` (never by a client header); `resolveRequestOrigin` uses it, and the auth-panel footer no longer prints `localhost:4321`. `site-origin:check` now also rejects `url.host` and `{Astro.url.origin}` used for output. Tenant custom domains behind a proxy still need `PUBLIC_TRUST_PROXY=true` (documented in `deployment-profiles`). `tests/tls-terminating-proxy.test.ts` premise updated: the listener-local host is no longer the "visitor's host".
