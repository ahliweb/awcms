---
"awcms": patch
---

Pin the two deployed environments to their domains: `awcms.ahlikoding.com`
(production) and `awcms-staging.ahlikoding.com` (staging).

Adds `docs/awcms/environments.md` (domains, per-environment `APP_ENV`/`APP_URL`,
staging isolation rules, DNS, edge-cache settings) and references it from
`.env.example` and `deploy-coolify.md`, which previously used only generic
placeholders.

`APP_URL` is called out specifically because it builds the OIDC/SSO callback URL
— a wrong host breaks login rather than just looking wrong.

Documentation and example configuration only; no runtime change.
