🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0106-domain-verification-proves-control-of-the-zone.id.md)

# ADR-0106 — Domain verification proves control of the zone, and the challenge is ours to mint

- **Status:** Accepted
- **Date:** 2026-08-22
- **Decision maker:** ahliweb
- **Related:** PROJECT_STATE §4 (found while closing finding D7 of the 17 August 2026 round); ADR-0006 (no outbound call inside a database transaction); ADR-0053 (platform scope); ADR-0063 (the authorization chokepoint); migration `sql/046`; Issue #555 (the original `tenant_domain` port)

## Context

`POST /api/v1/tenant/domains/{id}/verify` did not verify anything.

It read the row, checked that `verification_method IS NOT NULL`, and set `status = 'active'`. There was no DNS lookup, no file fetch, no token comparison anywhere on the route path. The Cloudflare adapter exists and can create and poll a verification record, but it is called only by `tenant-domain:dns:sync`, it refuses any name outside the platform's own managed zone, and it is not reachable from this route at all. The column that _named_ a method was the whole of the check.

An `active` domain is not a cosmetic flag. `resolvePublicTenantByHost` maps an inbound `Host` header to a tenant from `awcms_tenant_domains`; `resolveTenantDomainSet` treats the hostname as a permitted redirect target; `resolveTenantPrimaryHost` puts it in canonical URLs, feeds and sitemaps. So the sequence available to a tenant administrator holding `domains.create`, `.update` and `.verify` was: add a hostname, `PATCH` `verificationMethod: "manual"`, call verify — and this deployment now answers for that hostname as that tenant.

Two things bounded it and neither was the control. Creation and verification are ABAC-guarded, so this was a tenant administrator's reach rather than an anonymous one; and it only mattered for a hostname whose DNS somebody could actually point here, which is a property of somebody else's zone rather than of this code.

Finding D7 was closed by **deleting** the unread `defaultVerificationMethod: "manual"` setting rather than applying it, precisely so this would not get worse: applying that default would have handed every newly created domain the only precondition `verify` had.

## Decision

**A domain becomes `active` only when a server-minted, unguessable TXT record appears in the zone being claimed. Every part of the challenge is minted by this application and none of it is accepted from the caller.**

### Making the comparison real is only half a fix

The API accepted `verificationRecordName` and `verificationRecordValue` from the caller. Simply comparing those two against DNS would still prove nothing, because a caller who chooses **both** the name to query and the value to expect can point them at a record that already exists in a zone it does not control. `example.com` publishes plenty of TXT records; `hostname = example.com`, `recordName = example.com`, `recordValue = "v=spf1 -all"` passes a perfectly good DNS lookup without the claimant controlling one byte of that zone.

So both halves are server-owned:

- **The name** is derived from the hostname being claimed — `_awcms-verify.<normalized_hostname>` — so the record can only live in the zone actually under claim. The underscore label cannot collide with a real host and is not something a zone publishes by accident.
- **The value** is 32 random bytes, minted per domain row. "This record exists" and "we put this record there" become the same statement.

Neither is settable through the API any more. Supplying one is **refused with a 400 naming the field**, not ignored: a caller that sends `verificationRecordValue` believes it has chosen what will be checked, and silently dropping it would leave that belief intact while the server checked something else.

### One method, and it is the one that is implemented

`TENANT_DOMAIN_VERIFICATION_METHODS` offered `dns_txt`, `dns_cname`, `file` and `manual`. It now offers `dns_txt`.

- **`manual` is removed** because it never meant anything. It _was_ the old check.
- **`file` is removed** because implementing it means this server issuing an HTTP request to a hostname the caller chose — SSRF wearing a verification badge. It would need the full `isBlockedAddress` treatment, redirect handling and a response-size cap before it was safe, and none of that buys anything DNS does not already give.
- **`dns_cname` is removed** because it needs a platform target hostname to point _at_, which is per-deployment configuration that does not exist here. A second half-built method would not make the first one any more true.

`sql/046`'s CHECK constraint still accepts all four and is left alone — an applied migration is immutable, and the column stays honest documentation of what the schema was willing to hold. What changed is that this application only writes, and only honours, `dns_txt`.

### `manual` is removed rather than demoted to an operator action

The obvious alternative was to keep `manual` as an attestation only a platform operator may make. It is rejected on cost, not on principle.

A platform-scoped permission (ADR-0053) may only be exercised **by the platform tenant**, and `withTenant` pins RLS to that tenant — so a platform operator cannot see, let alone activate, another tenant's domain row. Making operator attestation work would mean building a new cross-tenant surface, which is the single most dangerous kind of surface this codebase has (the MFA admin reset is the only existing action that reaches outside its tenant, and it is deliberately alone). Building one to preserve a bypass is the wrong trade. With `dns_txt` implemented there is nothing an operator can attest that the tenant cannot simply prove.

Platform subdomains keep a path: the platform owns that zone, so the challenge record can be published there — by hand, or by the Cloudflare adapter that `tenant-domain:dns:sync` already drives, which is exactly the case its `isWithinPlatformRootDomain` guard was written for.

### DNS, and where the call happens

A DNS query goes to the configured resolver, never to the claimed host, carries no credentials, and cannot be aimed at `169.254.169.254`. That is why it is safe where an HTTP fetch would not be.

It runs **outside every database transaction** (ADR-0006). The route is three phases: a tenant transaction reads the challenge and refuses what is not verifiable; the lookup happens with no transaction open; a second tenant transaction re-authorises and records the outcome. Holding a pooled connection open for as long as somebody else's resolver feels like taking is how one slow dependency becomes a database outage.

The second transaction re-authorises rather than trusting the first. ADR-0063 puts the gate in the transaction that does the work, and a session revoked while DNS was being queried must stop the write, not merely have stopped the read. It also carries the proven value back into the `WHERE` clause: if the row was re-issued a fresh challenge, soft-deleted or suspended in between, the answer is `409 CONFLICT` rather than an activation earned by a challenge that is no longer the challenge.

### Absent is not unavailable

`NXDOMAIN`/`NODATA` is a fact about the **claimed domain** — the record is not published, which is the most ordinary answer there is. `SERVFAIL`, a refusal or a timeout is a fact about **our resolver** and says nothing about the domain.

Only the second kind feeds the circuit breaker, and only the second kind leaves the domain's status untouched (`503`, nothing written). Collapsing them is the defect finding D6 recorded against the email provider, where per-message rejections tripped a breaker that then stopped delivery deployment-wide. Here the same mistake would fail in both directions at once: tenants with mistyped hostnames would push the breaker open and lock out everybody else's verification, and a resolver outage would mark honest, correctly-published domains `failed`. An unrecognised error code is treated as _our_ problem, so a code this list has not met can never be read as "the record is definitely not there".

### A miss records `failed`

A failed check sets `status = 'failed'` and `last_checked_at`, and answers `409 DOMAIN_NOT_VERIFIED`. "Nobody has checked yet" and "we checked, and it was not there" are different facts and an operator needs to tell them apart. It also keeps `failed` reachable — a declared state nothing can produce is the exact defect shape findings D7, D8 and D15 were about, and creating a new one while closing that round would be a poor joke. `failed` is re-verifiable: it describes a moment, not a sentence.

### Rows that predate this decision

A domain created before this ADR has `verification_method = NULL` and no challenge, because nothing ever wrote one. On its first verify attempt the challenge is **minted and the caller is told to publish it** (`409`), rather than looked up — a record invented one millisecond ago cannot be in DNS, and a guaranteed-miss lookup would only teach the operator to distrust the answer.

There is no backfill migration. Minting lazily reaches exactly the rows that need it, at the moment somebody is looking at them, without a DML migration against a `FORCE ROW LEVEL SECURITY` table — which in this repo is a known way to be green in CI and broken in production.

### The lookup is rate limited per tenant

The `Idempotency-Key` requirement is not a rate limit; a caller mints a fresh one per attempt by design. Without a limit, an authenticated button becomes a DNS query generator aimed at any hostname the caller can name. Thirty attempts per minute per tenant — per tenant rather than per domain, because the resource being protected is this deployment's resolver, and a caller with a hundred domain rows is not entitled to a hundred times the budget.

## Consequences

**A tenant can no longer activate a hostname it does not control.** That is the point, and it is also the only behaviour change anyone will notice.

**`POST /api/v1/tenant/domains` no longer accepts three fields, and `PATCH .../{id}` no longer accepts them either.** They are refused with `400` rather than ignored. This is a breaking change to a documented request body; the OpenAPI module carries it, and the admin screen no longer offers a verification-method picker because there is nothing left to choose.

**A hostname too long to carry `_awcms-verify.` is refused at creation** rather than accepted as a row that could never be verified.

**Verification now depends on DNS resolution from the application host.** A deployment with no outbound DNS cannot verify domains, and will say so with a `503` rather than pretending. `tenant-domain-dns-verify` joins the provider circuit breakers already reported by `/api/v1/database/pool/health`.

**`verification_token_hash` is still written by nothing.** The challenge is not a secret — it is published in DNS, and its security property is unguessability before publication, not confidentiality after — so it lives in `verification_record_value`, a public column, exactly as the schema intended.
