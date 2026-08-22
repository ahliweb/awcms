---
"awcms": minor
---

fix(tenant-domain): verification that verifies (ADR-0106)

`POST /api/v1/tenant/domains/{id}/verify` did not verify anything. It read the
row, checked `verification_method IS NOT NULL`, and set `status = 'active'` —
no DNS lookup, no file fetch, no token comparison anywhere on the route path.

An `active` domain feeds `resolvePublicTenantByHost`, the redirect allow-list
and the canonical host, so the sequence available to a tenant administrator
holding `domains.create` + `.update` + `.verify` was: add a hostname, PATCH
`verificationMethod: "manual"`, call verify — and this deployment now answers
for that hostname as that tenant. Found while closing finding D7, recorded in
PROJECT_STATE §4 rather than fixed there because it needed a decision.

**Making the comparison real would only have been half a fix.** The API also
accepted the record NAME and VALUE from the caller, and a check against a
caller-chosen name and a caller-chosen value proves nothing — both can be
pointed at a record that already exists in a zone the caller does not control.
So both halves are now server-minted (`_awcms-verify.<host>`, 32 random bytes
per row) and supplying either is REFUSED with a 400 naming the field, not
silently ignored.

**One method survives, and it is the implemented one.** `manual` was the old
check. `file` means this server fetching a caller-chosen URL, which is SSRF
wearing a verification badge. `dns_cname` needs a platform target that does not
exist here. `manual` is removed rather than demoted to an operator attestation:
a platform-scoped permission may only be exercised by the platform tenant, and
RLS means it cannot see another tenant's row, so preserving the bypass would
mean building a cross-tenant surface — the most dangerous kind this codebase
has, and not worth building to keep a bypass alive. `sql/046`'s CHECK
constraint is untouched.

The lookup runs OUTSIDE every transaction (ADR-0006), between two tenant
transactions. The second re-authorises (ADR-0063) and carries the proven value
into its `WHERE` clause, so a challenge re-issued mid-flight cannot be cashed
in. **Absent is not unavailable:** NXDOMAIN is a fact about the claimed domain,
SERVFAIL is a fact about our resolver — only the second feeds the circuit
breaker or leaves the status untouched, which is finding D6's rule applied
where getting it wrong fails in both directions at once. A miss records
`failed`, keeping that state reachable and keeping "nobody checked" separable
from "we checked and it was not there".

Rows created before this change are minted a challenge lazily on their first
verify attempt — no DML migration against a `FORCE ROW LEVEL SECURITY` table.

**Breaking:** `verificationMethod`, `verificationRecordName` and
`verificationRecordValue` are no longer accepted by `POST /api/v1/tenant/domains`
or `PATCH .../{id}`. The admin screen no longer offers a verification-method
picker and shows the record to publish instead.
