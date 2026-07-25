---
"awcms": patch
---

Pin the default tenant per environment, and state the owner-account convention
for all three phases.

`PUBLIC_DEFAULT_TENANT_ID`/`_CODE` are now set in staging and production rather
than left to the end of the resolution chain. Unset still worked — the chain
terminates at `awcms_setup_state.tenant_id` — but that makes "which tenant does
an unmatched host resolve to?" an implicit answer living in a table rather than a
stated one, and it silently becomes the wrong answer the moment a second tenant
exists. The consumers are real: `seo_distribution` (`/robots.txt`, sitemap, feeds)
and `site_search`.

`PUBLIC_TENANT_RESOLUTION_MODE` is deliberately left unset. Production does have
an `awcms_tenant_domains` row for `awcms.ahlikoding.com`, so `host_default` would
work — but enabling host lookup widens the reachable surface and is its own
decision, not part of "set the default tenant".

Documents the owner convention across development, staging and production: the
login identifier `admin@ahlikoding.com` is shared, the password never is.
`awcms_identities` is unique on `(tenant_id, login_identifier)`, so one address in
three environments is three unrelated accounts with three password hashes and
three `AUTH_JWT_SECRET`s.

Also records the permission-seed gap where it will actually be read, with the
backfill SQL: a seed migration reaches only tenants created after it, so landing a
module does not grant its permissions to an existing owner — the symptom is a 403
on a module that is plainly installed. Plus the queries that show whether "full
access" is genuinely full, since RBAC 197/197 means nothing if an ABAC deny, an
SoD rule, or a business-scope constraint is in play.
