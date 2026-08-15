🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0090-delegated-access-prints-a-real-tenant-user.id.md)

# ADR-0090 — Delegated access prints a REAL tenant user

- **Status:** Accepted (2026-08-13).
- **Context:** Issue #423 Wave 8 PR 8.2. Migration `sql/117`.
- **Builds on:**
  [ADR-0089](0089-a-partner-is-an-ordinary-tenant.md) (a partner is an ordinary
  tenant; reach is data, and the row belongs to the TARGET tenant),
  [ADR-0050](0050-bff-session-handoff-code.md) (a short-lived hashed artifact
  that PRINTS a fresh session — the exact shape borrowed here),
  [ADR-0082](0082-an-invitation-carries-its-own-policy.md)
  (`materializeMembership`: one membership writer, and it rejects system
  roles), and [ADR-0085](0085-one-human-one-credential-many-tenants.md) (the
  human redeeming already has a global credential — without it this ADR would
  have to create a second credential for the same person).

## Decision

A redeemed grant **does not produce a new kind of actor.** It produces an
ordinary `awcms_tenant_users` row in the target tenant, bound to a role
**chosen by the customer**, with an expiry date.

That is the whole idea: **RLS, the decision log, audit, SoD, and business-scope
facts work without a single change**, because the actor really is a tenant user
there. The alternative — a "partner actor" that is not a tenant user — demands
that every authorization reader in this repo learn a second shape, and whoever
forgets to learn it fails open.

What crosses the inter-organization boundary is the **short-lived redemption
code** (`awcmsd_…`, hash `dg-sha256:`), not a live credential and not a
cross-tenant read.

## There is no platform-planted `support` role

The Wave 8 plan wrote "bound to a limited `support` role". Checked: **roles in
this repo are PER-TENANT rows**, and the only one that is planted is `owner`
(`platform-bootstrap.ts`). Planting `support` into every tenant demands a seed
migration **plus a backfill** — a seed only reaches tenants created after it,
and older tenants would silently 403, a trap already recorded in this repo.

But the real objection is not mechanical. Planting `support` means **the
platform decides what a partner may touch inside someone else's tenant.**
ADR-0089 just rejected that shape for the question of who the partner is;
accepting it for the question of what the partner may do would undo it from the
other side.

`role_id` points at a role that **already exists in the target tenant**. The
customer chooses. `materializeMembership` rejects `is_system` roles, so `owner`
is not an option — an existing rejection that now carries new weight.

## The one thing the role choice CANNOT bound

The role choice is the general control. There is one thing it cannot safely
bound: **access-control authority**.

A delegated actor who may grant roles, create groups, or set policy can create
power that **outlives its own grant**. Revoke the grant, deactivate its tenant
user, and the rows it handed to other people remain. **Revocation stops being
revocation** — and not a single gate will say so, because every step of it was
legitimate.

So the chokepoint rejects, deny-only, on top of `fetchGrantedPermissionKeys`
alongside the other structural gates (cross-wave rule 1): **in the
`identity_access` module, a delegated actor only READS.**

Its shape is one sentence, not a list of actions. A list of actions would go
stale silently every time that module grows a new activity, and what goes stale
here is a hole. Widening it later demands naming which action and why that
action cannot create persistence. Its failure mode also leans the right way:
too strict means the customer performs one step themselves, not a security
hole.

## `principal_kind` lives on `awcms_tenant_users`, not on the session

That gate must be answerable by **every** path that reaches the chokepoint, and
there are two: via a session (`resolveTenantPrincipal`) and via a tenant user
directly (`resolveTenantPrincipalForTenantUser`, the machine-credential path).

Leaning on `awcms_sessions.origin_auth` would leave the second path
**ungated**, and its failure would be silent — the "the writer moved, its
readers did not" class that produced ADR-0079. The column therefore lives on
the row that **both paths already SELECT**: the gate is free and cannot be
bypassed.

It is **write-once**. A delegated membership is born delegated and never
becomes an ordinary member, so there is no second-writer obligation that could
drift. `machine` deliberately is not a third value even though the planned ABAC
attribute `subject.principalKind` includes it: a machine credential is not a
tenant user, its kind is carried by its hash namespace (ADR-0049), and copying
it here creates a second source that can disagree.

## The redemption code is a second bearer the gate must REJECT

ADR-0088 established that a selection token must never authenticate
`authorizeInTransaction`. This code joins it in that same first statement, for
the same reason: someone **will** paste it into an `Authorization` header, and
a hash that happens not to match any session row is a storage coincidence, not
a control.

Its prefix also joins `RESERVED_TOKEN_PREFIXES`, so a random session token can
never be born in a namespace the gate rejects.

## Dies with its grant, in the same transaction

Revocation and expiry deactivate the membership **and** revoke its sessions in
the same transaction — the `setTenantUserStatus` pattern, with higher stakes
because the account belongs to another organization.

`setTenantUserStatus` itself is deliberately **not** used: the "cannot
deactivate yourself" and "last system admin" rules there are controls for
MEMBERS, and both are wrong here. A delegated membership must not be able to
block its own revocation by holding a system role — and via
`materializeMembership` it cannot hold one, which makes that rule not merely
wrong but also inapplicable.

Delegated sessions carry `origin_auth = 'delegated'` and **must not switch
tenants**. A grant for tenant C that can be carried into tenant D is not a
grant; it is a way in. The non-switchable rule stops being spelled inline in
`switch.ts` and becomes one list, `NON_SWITCHABLE_ORIGIN_AUTH` — two values may
still be spelled out, three is already where the fourth value gets forgotten.

## Consequences

- A grant living longer than 31 days **cannot exist** (CHECK `sql/117`), and
  the rule is 30 (`DELEGATED_ACCESS_MAX_TTL_DAYS`). The one-day difference is
  deliberate: `created_at` DEFAULT `now()` is the TRANSACTION START instant
  while `expires_at` is computed from an application clock that is always
  later, so a CHECK for "exactly 30 days" would reject perfectly normal rows.
- Because its TTL is bounded, the 365-day retention descriptor **can safely use
  `executionMode: 'generic'`** — an age-based sweep cannot delete a live grant,
  because no live grant is old enough to be reached. This is the only
  descriptor in this module that can say that.
- A grant cannot exist without a live partnership: a composite FK to
  `awcms_partner_managed_tenants (tenant_id, partner_tenant_id)`.
- This PR lands **inert** — no route calls it yet. Its surface is PR 8.4, and
  that PR will not also add its data model.

## Correction (PR 8.4, `sql/120`) — a grant outlives its partnership

`sql/117` bound a grant to the partnership row with a composite FK, and the
reasoning sounded right: "a grant can only exist where its partnership exists".

**Measured by running it, that is wrong.** Once a single grant has ever been
created, breaking the partnership FAILS forever: an already-revoked grant still
references the mapping row, and revocation deliberately does not delete it — it
is a 365-day retention record. So the customer who most needs to break the
partnership, whose partner ACTUALLY got in at some point, is the only one who
cannot.

The right shape: **a grant is HISTORY, a partnership is PRESENT STATE.** "Who
was ever able to see our data" is asked most precisely after the vendor has
been dismissed. The FK is moved to the `awcms_partners` registry, and the
invariant "no grant without a live partnership" stays enforced by the database
**at write time** via `INSERT … SELECT … WHERE EXISTS` — a predicate inside the
same statement, not a check that precedes it, because the latter is a TOCTOU.

Found by E2E, not by review. That itself is a note worth keeping: the FK read
correctly on every reading until someone ran the full sequence.

## Rejected

- **A platform-planted `support` role** (and the seed+backfill that comes with
  it).
- **A partner actor that is not a tenant user** — every authorization reader
  would have to learn a second shape, and whoever forgets fails open.
- **Copying the principal's credential hash into the target tenant's
  `awcms_identities.password_hash`** — a credential in a second place, exactly
  what ADR-0085 avoids. The column is filled with a hash of 32 random bytes: a
  "no" that stays "no" for whoever reads it later.
- **Deriving the human's address from a string supplied by the target tenant** —
  that would let the tenant choose WHOSE principal the membership attaches to.
  The address is read from the global principal row, via the store that owns it.
- **Using `setTenantUserStatus` to kill a delegated membership.**
- **Letting a delegated session switch tenants.**
- **A list of forbidden actions** instead of one sentence about one module.
