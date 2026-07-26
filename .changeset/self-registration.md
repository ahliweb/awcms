---
"awcms": minor
---

Add admin-approved self-registration — off by default, and it never stores a
credential.

`POST /api/v1/auth/register` records a request; `/admin/registrations` reviews
it; approval creates the account. Two migrations (`sql/074` schema, `sql/075`
permissions), one public page (`/register`), three guarded admin endpoints.

**Off unless `AUTH_SELF_REGISTRATION_ENABLED=true`**, and a disabled deployment
answers `404` — the same answer a nonexistent route gives, so the switch is not
discoverable by probing. An always-on public endpoint that writes a row is a
spam surface every deployment would otherwise inherit. It is a deployment-level
gate like `AUTH_MFA_ENABLED`, so turning it on opens registration for every
tenant; per-tenant granularity is recorded as a follow-up rather than implied.

**The public path creates no account and accepts no password.** It writes a
`pending` row and nothing else, rejects every privilege field (`roleIds`,
`status`, `tenantUserId`), and the validator returns exactly two keys — proven
twice, at runtime by asserting the returned key set and structurally by
enumerating which fields are read off the untrusted body. Mutation-proven:
leaking `roleIds` through the validator turns both red.

**Approval issues a credential the applicant must claim, which is a deliberate
departure from awcms-micro.** micro stores an argon2id hash chosen by an
unverified stranger for an account that may never exist. Here the identity is
created with an *unusable* password — the hash of 32 CSPRNG bytes discarded
immediately — and the applicant receives a password-reset link through the same
flow `/forgot-password` uses. So no anonymous submitter's secret is ever stored,
a rejected or abandoned request leaves no credential behind, a spam flood costs
an INSERT rather than an argon2id hash, and the applicant proves mailbox control
before the account works. The cost is stated rather than hidden: `approve`
returns `delivery: "queued" | "unavailable"` so the admin screen can say when
the link could not be sent instead of showing a success for an account nobody
can get into.

**Enumeration-safe.** An address that already has an account, one with a request
already pending, an inactive tenant and a fresh request all return the identical
200 — "this address is already registered" is the single most useful sentence an
attacker could be handed here. The audit event records which it was, without the
submitted address on a miss.

**`approve` and `reject` are separate permissions** under a new
`registration_requests` activity. `access_control` is the RBAC catalog, not the
authority to admit a person, and `/api/v1/users` in this repo is read-only — so
approval is the first admin path that materializes an identity at all, and
clearing spam should not require the ability to admit anyone. `roleIds` is
optional and defaults to none; an unknown role refuses the whole approval rather
than granting the subset that resolved.

**Approval is race-safe**, with `FOR UPDATE` on a `status = 'pending'`
predicate. Mutation-proven: without the lock two concurrent reviewers trip
`awcms_identities_tenant_login_key` mid-transaction and the second gets a 500;
with it, a clean 404. Correctness was never at risk — the failure mode was.

Rejection notifies nobody: a rejection email would confirm to an anonymous
submitter that this tenant exists and reviewed them, which is exactly the
disclosure the submit endpoint refuses to make.

Reviewed rows are purged by the existing `data_lifecycle` GENERIC engine (90d
default, 7d floor so the `registration_approved` audit row still points at
something); the worker grant is `SELECT, DELETE` only — one able to write here
could manufacture an approved registration.
