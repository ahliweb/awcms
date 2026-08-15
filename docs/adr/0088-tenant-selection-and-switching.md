🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0088-tenant-selection-and-switching.id.md)

# ADR-0088 — Selecting a tenant, and switching between tenants, without ever being able to authorize

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 7 PR 7.4 — the last PR of this wave. Migration
  `sql/115`.
- **Builds on:**
  [ADR-0085](0085-one-human-one-credential-many-tenants.md) (a principal is an
  AUTHENTICATION fact, never an AUTHORIZATION fact — this ADR is the first test
  of that sentence),
  [ADR-0086](0086-the-lockout-counter-is-global.md) (credentials and lockout are
  already global, which is what makes a tenant-less login possible at all),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) (MFA factors already belong to
  the human, so one enrolment satisfies the obligation of whichever tenant is
  picked),
  and [ADR-0049](0049-machine-credentials-and-session-introspection.md)
  (the bearer kind is carried by its hash namespace — copied **exactly** here).

## Decision

A login without `x-awcms-tenant-id` stops being `400 TENANT_REQUIRED` and
becomes **`409 MEMBERSHIP_SELECTION_REQUIRED`** carrying a **selection token**
that lives ≤120 seconds and is single-use. That token is exchanged at
`POST /api/v1/auth/session/tenant` for a session on the tenant **named by the
caller**. An existing session can switch through
`POST /api/v1/auth/session/switch`.

> **A selection token must NEVER authenticate `authorizeInTransaction`.**

That sentence is the most dangerous invariant in the whole #423 programme, and
it is enforced the same way ADR-0049 separates machine credentials from
sessions: **the kind is carried by the hash namespace**,
`isPrincipalSelectionHash()` is checked **before** anything inside the gate, and
a principal hash produces a hard 401 **without a single decision log row**.

## The `409` does NOT carry the membership list, and that is not a saving

The Wave 7 plan imagined a picker. PR 7.1 even wrote that the
`awcms_identities (principal_id)` index "serves the query for every membership
of this human, which is the basis of the Wave 7 tenant switch".

**That query cannot see more than one tenant.** Measured, not inferred — as
`awcms_app` against a real database containing one human with identities in two
tenants:

| What was asked                                                | Result |
| ------------------------------------------------------------- | ------ |
| all memberships of that principal, inside tenant A's context  | 1 row  |
| the same, with no tenant context (the header-less login path) | 0 rows |

`awcms_identities` is FORCE RLS. This is the **same class of finding** that took
down the "audit in both tenants" plan in ADR-0087, two PRs in a row: a plan that
assumes a cross-tenant read the policy forbids.

What is different: here there is a buildable way out — **a global membership
projection table** maintained by every writer of identities. That is
**REJECTED**, and the rejection is a product decision, not a technical
limitation:

- It is, literally, a **cross-tenant membership directory** — the shape ADR-0087
  refused to build in another guise (the list of tenants reached by an MFA
  reset). Refusing it in one place and then building it somewhere else a month
  later is not consistency.
- It creates a **new writer obligation**: one missed identity writer means a
  tenant missing from the picker **forever and silently** — exactly the failure
  mode ADR-0086 paid dearly for with a nullable `principal_id`, and which just
  recurred as `unlinked_factor` in ADR-0087.
- It adds a **fourth global table** that grows with membership, with a stale row
  every time an identity is deactivated.

**Instead: the caller names its tenant.** That is not a real loss of capability
— the admin surface is already host-resolved
([ADR-0059](0059-host-resolved-public-content-routes.md)), so the tenant is
known from the URL before the login form is rendered; and every API client today
is already required to send `x-awcms-tenant-id`. The only thing genuinely lost
is the "which tenants are you a member of" screen, and the real price of that
screen is a membership directory nobody should hold.

## The selection token lives in `awcms_principals`, not in a fifth table

Two columns: `selection_token_hash` (unique when not NULL) and
`selection_token_expires_at`. **One live token per human** — asking for a new
one deletes the old one, the precedent being `deletePendingFactors` in MFA
enrolment (only the last QR may be confirmed).

The alternative is a dedicated `awcms_principal_selection_tokens` table, and it
is worse on every axis that matters: one row **per tenant-less login attempt**
means a table that grows with **traffic**, so it needs a retention descriptor, a
purge job, `DELETE` rights for `awcms_worker`, a lifecycle registry entry, and a
gate allow-list entry — all that machinery for a row that lives 120 seconds. Two
columns on a row that **already** exists do not grow at all.

An accepted consequence: two parallel tenant-less logins by the same person mean
the second invalidates the first. The window is 120 seconds, and fewer live
credentials is the correct property, not a regretted one.

**The `identity:principal-access:check` gate is widened by one predicate**:
`selection_token_hash = ${…}` becomes a legitimate keyed shape for
`awcms_principals`, alongside `id =` and `email_normalized =`. It still binds a
single row — the unique index guarantees that — and this widening is written
down here so that it is a review decision, not an addition that slipped through
because it was convenient.

## Three gates the selection path may not skip

Exchanging a token for a session is a **half-finished login**, not key delivery.
Every control that applies at `/auth/login` applies again once the tenant is
finally known:

1. **A `suspended`/inactive tenant is rejected** ([ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md)).
2. **The destination tenant's auth policy applies.** A tenant that disables
   password login for an identity rejects that exchange — otherwise, picking a
   tenant becomes a detour around an SSO-only policy.
3. **The destination tenant's MFA policy applies, and this is the easiest one to
   forget.** Tenant B may require MFA even if tenant A does not. Issuing an
   `aal1` session into tenant B because the person already proved a password
   somewhere else would turn tenant switching into an **MFA bypass** — and the
   worst hurt would be the tenant with the strictest security posture. The
   selection and switch paths therefore use the **exact same** gates as login:
   `MFA_REQUIRED` + challenge, or `MFA_ENROLLMENT_REQUIRED` + an enrolment
   grant. Since ADR-0087 the factor already belongs to the human, so the same
   authenticator satisfies tenant B's obligation without re-enrolling.

**Assurance does not travel.** A new session is born `aal1` even if its source
session was `aal2`: step-up is fresh proof for **one** tenant, and carrying it
across would mean a step-up in tenant A satisfying tenant B's demand.

## The non-switchable rule, and the takeover it closes

A session whose `origin_auth` is **`sso`** or **`handoff`** MUST NOT switch.

Without that rule: the IdP administrator of tenant B asserts `alice@corp.com` —
an address their own IdP is allowed to claim — receives a legitimate tenant B
session, and then **switches to tenant A** where the real Alice works. A complete
cross-tenant takeover, through a feature that looks like a convenience, without
a single control being violated: every step of it is legitimate.

The only thing that makes switching safe is a **global credential**: a password
verified against `awcms_principals` proves the human, and no tenant can issue
it. An IdP assertion proves something far narrower — that the tenant is willing
to call you by that name. `handoff` is rejected for the same reason: it is not
proof of a credential.

A session produced by switching has `origin_auth = 'switch'` — the fourth value
`sql/100` already anticipated and deliberately did not put in the CHECK at the
time, with the sentence "a CHECK containing a value nothing can produce reads as
a capability that has already shipped". `sql/115` now produces it, so `sql/115`
is what adds it. A `switch` → `switch` chain is still allowed: its root is still
a password, and step-up rotation already carries `origin_auth` forward
(`stepUpSession`), so `sso` cannot disguise itself as `switch`.

## A credential that has not been promoted rejects a tenant-less login

`sql/112` deliberately leaves the principal `password_hash` NULL; it is promoted
on the first successful login (ADR-0086). A login **without** a tenant has no
identity to verify as a fallback — that is the essence of its shape — so a human
who has not logged in since the migration gets the same generic failure as a
wrong password.

This is **deliberately not** softened with a special message: "this account has
never logged in" is an enumeration oracle. The recovery path already exists and
needs nothing new — log in once with the tenant header (the shape every client
uses today) and the credential is promoted, and tenant-less login works from
that moment on.

## REJECTED

- **The membership list in the 409 response** (what the plan asked for).
  Impossible under FORCE RLS without `SECURITY DEFINER`/`NO FORCE`, and the
  global projection that would make it possible is the cross-tenant membership
  directory ADR-0087 rejected. See above.
- **A dedicated `awcms_principal_selection_tokens` table.** It grows with
  traffic for a row that lives 120 seconds; two columns on an existing row do
  not grow at all.
- **Carrying `aal2` across tenants.** Tenant A's step-up would satisfy tenant
  B's demand.
- **Allowing an SSO session to switch.** A complete cross-tenant takeover; see
  above.
- **A long-lived or reusable selection token.** It is the only bearer in this
  system that is not bound to a tenant; every extra second and every extra use
  is pure widening.
- **Making the selection token a bearer accepted by `resolveAuthInputs`.** It
  may only be accepted by the single endpoint that exchanges it, and the
  rejection at the gate is tested against five guarded endpoints plus a
  zero-decision-log assertion.
