🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0049-machine-credentials-and-session-introspection.id.md)

# ADR-0049 — Read-only machine credentials (service account bearer) + cross-origin session introspection

- **Status:** Accepted
- **Date:** 2026-08-01
- **Decision makers:** @ahliweb
- **Closes:** [ADR-0047](0047-mini-micro-frozen-foundation-built-here.md) §Consequences — the two contracts holding `awcms-astro` back, which that ADR called "one design conversation, not two"
- **Implements:** [ADR-0045](0045-jualanku-porting-awcms-system-of-record-astro-bff.md) (the session introspection endpoint belongs to `identity_access`; its surface design is in [`../awcms/jualanku/05-kontrak-sesi-dan-bff.md`](../awcms/jualanku/05-kontrak-sesi-dan-bff.md) §3)
- **Bound to:** [ADR-0048](0048-frontend-role-split-awcms-astro-internal-admin.md) §1 — moving a screen does not move its permissions; the authorization surface stays ONE
- **The first foundation feature built directly here** under the ADR-0047 §2 regime, and therefore must satisfy §3 (ADR, security review for `auth`/`access`, full `bun run check`, RLS `FORCE`, ABAC default-deny) and §4 (recorded as a divergence in [`awcms-family-compatibility.yaml`](../../awcms-family-compatibility.yaml) **when it lands**)

## Context

The only bearer this repo accepts is a hashed **session token**
(`awcms_sessions`, `sql/004`). A build process cannot hold one, and not because
of a configuration accident:

- sessions **expire** and are not extended by use;
- a password reset **revokes every session** of that identity (`sql/073`) — the
  build would die silently every time a human changes their password;
- MFA step-up **rotates** the session token (`sql/024`, anti-fixation);
- a session is bound to one human identity, so "who pulled this content" is
  forever answered with a person's name.

`awcms-astro`'s `.env.example` tells the operator to fill in "a BUILD-TIME,
READ-ONLY token" — an instruction to issue something **nobody can issue**, in any
repo in this family. ADR-0047 verified this against staging rather than inferring
it from a document.

The second need comes from the opposite direction. The `awcms-astro` BFF holds a
user's session token and needs to ask "is this session still alive? whose is it?
what are its roles?" without touching the `awcms` database and without putting
the token in the browser. ADR-0045 already decided the endpoint; the code was
never written.

Both meet at the same point: **what a non-human caller is entitled to do.** Hence
one ADR, not two.

## Decision

### 1. A machine credential AUTHENTICATES; it never AUTHORIZES

The new table `awcms_machine_credentials` (tenant-scoped, `FORCE` RLS) stores a
token hash, and every row is **bound to an existing `awcms_tenant_users`** — a
service account. Once that principal is resolved, the entire chain below it is
**completely unchanged**: `resolveModuleEnabled` →
`fetchGrantedPermissionKeys` → `evaluateAccess` (RBAC + ABAC DSL, default-deny,
deny-overrides-allow) → decision log → the SoD chokepoint.

The alternative "the credential carries its own permission list" is **rejected**:
that is a SECOND authorization surface, exactly what ADR-0048 §1 forbids. What a
credential may do must be answered by the same permission engine that answers
that question for humans.

### 2. Scope can only NARROW, never widen

`allowed_permission_keys text[]` is mandatory and must be non-empty. A
credential's effective permissions are the **intersection**:

```
effective = service_account_permissions  ∩  allowed_permission_keys
```

Adding a role to the service account does **not** widen an already-issued
credential. An empty list means it can do nothing (fail-closed), not
"unbounded" — the opposite default direction is how an allow-list turns into
decoration.

### 3. READ-ONLY, enforced before permissions are looked at at all

A request authenticated by a machine credential is **rejected** unless
`guard.action` is in the read-only allow-list, which today holds exactly one
value: `read`. The rejection happens at the same chokepoint
(`authorizeInTransaction`), **before** the permission lookup, and does **not
depend** on anything the service account holds.

The deliberate consequence: a leaked build token cannot change anything — not
even if the operator mistakenly pointed it at an `owner` account. Widening this
allow-list needs its own ADR; it is not a constant that may be extended in
passing.

### 4. The token carries its own tenant

Format: `awcmsm_<tenantIdHex32>_<32-byte base64url secret>`. The `awcmsm_` prefix
is **not secret** and acts as a discriminator: a token is recognised as a machine
token **before** any query, so it remains one lookup per request and a machine
token can never be looked up in the session table's namespace (or vice versa).
Only its SHA-256 is stored.

This is also what closes the FIRST contract defect in ADR-0047 for build clients:
the tenant is derived **from the token**, so a build needs only one environment
variable and the tenant header is no longer relevant to it. If a tenant header is
still sent and differs, **the token wins** and the header is ignored — it is
unauthenticated input, and that credential is only valid for its own tenant
anyway, so ignoring it cannot escalate anything.

**The canonical header for human sessions remains `x-awcms-tenant-id` — no new
aliases.** Adding `X-Tenant-Code`/`X-Tenant-Id` would mean every future route
must honour three spellings, and an alias missed on one route is a confusing 400,
not a clear failure. The cross-origin human caller is the BFF, which derives the
tenant from the host — not from a client guess.

### 5. Mandatory expiry, immediate revocation, visible use

`expires_at` is `NOT NULL` (upper bound 365 days, enforced in the domain): there
are no eternal credentials. Revocation takes effect on the next request because
the lookup reads that same row — this is why an opaque hashed token was chosen
over a signed JWT, which has no answer for "revoke now" without a list that must
be read as well.

Service account deactivation takes effect **immediately**: the machine path
requires `awcms_tenant_users.status` and `awcms_identities.status` to be active —
deliberately stricter than the session path, which checks neither but is bounded
by the session lifetime. Nothing revokes credentials when an account is
deactivated, so inheriting that leniency would mean leaving keys that keep
working for months. Stricter can only deny; it can never grant what the session
path denies.

`last_used_at` is updated **at most once per hour** (one conditional `UPDATE`),
so an idle or leaked credential can be spotted without adding a write to every
read request.

The plaintext is shown **once** at issuance and can never be retrieved again. No
token-fragment "hint" is stored: it adds no identification capability over
`id`+`name`, and it is secret material.

### 6. The decision log records the credential, not just the account

`awcms_abac_decision_logs` gets a nullable `machine_credential_id` column.
Without it the actual forensic question — "**which token** read this" — has no
answer, because several credentials may point at the same service account.

### 7. `GET /api/v1/auth/session` — introspection, sessions only

Owned by `identity_access`. Accepts **session tokens only**; a machine credential
gets the same generic 401 as an unknown token (a machine credential has no
session to introspect, and distinguishing it would make this endpoint a
token-type oracle).

Returns **safe claims only**: `identityId`, `tenantId`, `displayName`,
`roles[]`, `assuranceLevel`, `expiresAt`, `scopes[]`. It never returns the token,
the token hash, password status, MFA secret/recovery material, or raw identifiers
(email/phone). Nonexistent, expired, and revoked sessions all produce **one and
the same response shape**. `Cache-Control: private, no-store`, and rate-limited
via `src/lib/security/rate-limit.ts`.

It is **not** a duplicate of `GET /api/v1/auth/me`: `me` returns the raw
`loginIdentifier` (email) and says nothing about roles/assurance/expiry —
exactly the inverse of what a public portal header is allowed to see.

### 8. Issuance & revocation are audited admin actions

A new permission activity `machine_credentials` with `read`/`create`/`revoke` —
not a widening of `access_control`. The reason is the same one `sql/075` records
for `registration_requests`: issuing a credential that can read tenant data with
no human behind it is an authority of its own, and folding it into
`access_control.configure` would make every role editor a credential issuer as a
side effect. `create` and `revoke` are separate because only one of them creates
a new capability.

## Consequences

**What is unblocked.** `awcms-astro` can pull published content at build time
with a single env var, and its BFF can validate portal sessions without touching
the `awcms` database. Both are the "victims" ADR-0047 named.

**Old routes are safe too, untouched.** Enforcement lives in
`authorizeInTransaction` and tenant derivation lives in `resolveAuthInputs` — two
functions EVERY route passes through, both those using `defineTenantRoute` and
the ~200 routes that still write their own chain. Routes that read the tenant
header directly without `resolveAuthInputs` (e.g. `/api/v1/auth/me`) do not know
machine tokens at all and reject them — the correct failure direction.

**An accepted cost — family divergence.** `awcms-mini`/`awcms-micro` have no such
concept. Recorded in `awcms-family-compatibility.yaml` when it lands, per
ADR-0047 §4; its repatriation is handled by a later repatriation ADR.

**A risk named so it can be refused.** "Read-only" is easily read as "harmless".
It remains a credential that reads tenant data with no human behind it: a leak =
a data leak, not merely a nuisance. That is why its expiry is mandatory, its
scope must be narrowed, its use is visible, and its issuance is audited.

## Alternatives considered

**JWT/asymmetric keys.** Rejected: without a revocation list it cannot be
revoked, and once that list exists its "no lookup" advantage is gone — while an
opaque hashed token is already this repo's session pattern.

**Riding on `awcms_sessions` with a `kind` column.** Rejected: every invariant of
that table assumes a human. "Revoke all sessions on password reset" would kill
the build; step-up rotation assumes someone can perform a step-up.

**Building it in `awcms-astro`.** Rejected again (ADR-0047 §Alternatives):
`awcms-astro` has no database and is not an identity issuer. ADR-0048 gives it
internal screens, not an identity store.

**Accepting `X-Tenant-Code` as an alias.** Rejected — see §4.
