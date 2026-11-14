---
"awcms": minor
---

feat(auth): the pre-session pages `/login`, `/forgot-password` and `/reset-password` now speak the reader's language (Issue #1324, ADR-0095). Language is resolved as cookie, then the tenant default, then `Accept-Language`, then `en`, with `<html lang>` set accordingly and `en.po`/`id.po` entries under the `login` and `recovery` contexts. The tenant default is used only where the page already knows the tenant without an oracle: the single tenant of a one-tenant deployment, or a tenant carried by a sealed reset link; a selected, typed or plain `?tenantId=` tenant never influences the language. No change to authentication, rate limiting, lockout, Turnstile, cookies or CSRF; every failure message is one fixed sentence per language and the confirmation on `/forgot-password` no longer shows the server text. `/register` and `/accept-invitation` remain English.
