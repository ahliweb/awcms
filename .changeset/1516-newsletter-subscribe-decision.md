---
"awcms": patch
---

fix(newsletter): `POST /api/v1/newsletter/subscribe` no longer throws `ReferenceError: Cannot access 'decision' before initialization` for a new address on a resolved tenant. `withPublicNewsletterTenant` now passes the classified origin decision to its handler as a third argument, so the confirmation URL is built on the request origin (or, for a granted cross-origin request, on the site origin) and the confirmation email is enqueued. Refused and unresolved paths and the neutral body are unchanged (#1516).
