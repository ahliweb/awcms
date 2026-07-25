---
"awcms": minor
---

Wire the Cloudflare DNS adapter so a database row becomes a working subdomain.

Adds `ensureServingRecord` to the `TenantDomainDnsProvider` port and a
reconciliation job (`bun run tenant-domain:dns:sync`) that brings the managed
Cloudflare zone into line with the active `domain_type = 'subdomain'` rows in
`awcms_tenant_domains`.

Reconciliation, not a create-time API call: it is idempotent, retries a failed
record on the next pass, and heals drift introduced by hand in the dashboard —
none of which a side effect inside the create request can do. Serving records
are desired-state, so a drifted record is moved with `PUT` rather than joined by
a second record that would round-robin the tenant between two targets.

Scope: platform subdomains only. Custom domains live in the tenant's own zone
and keep the manual/TXT verification flow. Nothing is ever deleted.

`sql/069` grants the worker `SELECT` (only) on `awcms_tenant_domains`. Unset
config is a no-op: there is deliberately no default serving target.
