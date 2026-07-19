---
"awcms": minor
---

Add deployment-profile-aware Cloudflare Turnstile bot protection (Issue #186,
epic #177), ported and hardened from awcms-mini. A new full-online deployment
gate (`AUTH_ONLINE_SECURITY_ENABLED`/`AUTH_ONLINE_SECURITY_PROFILE`) plus
`TURNSTILE_ENABLED` activate a server-side Turnstile challenge on
`POST /api/v1/auth/login` and `POST /api/v1/setup/initialize`. The verifier runs
after request-shape/rate-limit checks and before password verification, outside
any DB transaction, and validates success, action (per endpoint), hostname, and
challenge freshness with a timeout, response-size cap, and secret/token
redaction (the token is never logged or audited). On the full-online profile it
fails closed with a single generic error (no account-enumeration oracle); rate
limit and lockout keep working independently.

Every LAN/offline deployment (the default) is unchanged: no widget, no iframe,
no CSP origin, and no outbound verification call — `isTurnstileRequired()`
returns false there, and `TURNSTILE_ENABLED=true` alone (without the full-online
profile) is still fully off. When enabled, the middleware CSP opens exactly the
one `challenges.cloudflare.com` origin in `script-src`/`frame-src`, the login
page renders the widget, and `config:validate` + `security:readiness` +
production preflight validate the site key, secret key, and expected hostname
consistently while distinguishing "disabled intentionally" from "misconfigured".
The login/setup request contract gains an optional `turnstileToken` field.

No database migration is added — Turnstile is configuration/env only; the secret
key lives in the environment and never touches the database, logs, audit,
responses, or health output. MFA (#184) and OIDC break-glass (#185) login
branches are preserved intact.
