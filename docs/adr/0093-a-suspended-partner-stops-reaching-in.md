🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0093-a-suspended-partner-stops-reaching-in.id.md)

# ADR-0093 — A suspended partner STOPS reaching in, and its grants remain

- **Status:** Accepted (2026-08-13).
- **Context:** Issue #543. Migration `sql/124`.
- **Builds on:**
  [ADR-0089](0089-a-partner-is-an-ordinary-tenant.md) (a partner is an ordinary
  tenant; the registry belongs to the platform),
  [ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md)
  (suspension is enforced at the chokepoint, not by a job),
  [ADR-0084](0084-an-entitlement-refuses-it-never-grants.md) (an entitlement
  REFUSES, it never revokes what is already running), and
  [ADR-0090](0090-delegated-access-prints-a-real-tenant-user.md) /
  [ADR-0091](0091-two-sided-attribution.md) (a delegated actor is a real tenant
  user with two-sided attribution).

## Why an ADR, and why now

`sql/116` gave `awcms_partners` a `status` column pinned to `'active'` by a
CHECK, and wrote its own condition in the file header:

> PR 8.4 widens this CHECK in the same PR as its reader, or not at all.

Shipping a partner that CAN be suspended before anything READS the suspension is
a control that reads as enforced while it is not — the same shape `sql/106` used
for `scope_type`. So the question is not "add a column", it is **what a suspended
partner means**, and that is three decisions.

## Decision 1 — Suspension STOPS reach that is already running

Not merely refusing new engagements.

The nearest precedents point in two directions, and the difference is their
reasoning:

- **ADR-0084** decided that an entitlement **refuses** and never revokes what is
  already running. The reason is proportionality: an entitlement is a COMMERCIAL
  gate, and cutting off work in progress because a plan changed is a punishment
  out of proportion to its cause.
- **ADR-0073** decided that a suspended tenant **stops being served immediately at
  the chokepoint**, already-issued sessions included. The reason is written there:
  before that, suspending a tenant killed its public site instantly while every
  already-issued admin session stayed fully in power until it expired on its own —
  "the customer loses what its visitors see and keeps holding what can change its
  data".

Partner suspension is the SECOND class. It is not a plan change; it is an action
against a party whose reach into customer data is exactly what you are trying to
stop. A suspension that only refuses NEW engagements would let every delegated
actor already inside keep working — precisely the failure ADR-0073 named, moved
one level outwards.

That is why enforcement is at the **chokepoint**, not a job. A job leaves a
window; a chokepoint is evaluated per request.

## Decision 2 — Live grants do NOT die with it

`sql/120` deliberately makes grants **outlive** their partnership, and the reason
is written there: "who was ever able to see our data, and until when" must remain
answerable AFTER the vendor has been let go — especially after that.

Suspension therefore does not revoke, does not delete, and does not touch a
single grant row. It makes those grants **ineffective**, not absent. The rows
stay as a record; the access they conferred stops.

This shape already has a name in the repo: "status is a cache, `effective_to` vs
`now()` is the real gate" (`isSoDConflictExceptionCurrentlyValid`). Validity is
COMPUTED, not stored — so there are no two places that can diverge, and restoring
a partner restores its reach without anyone having to rewrite anything.

If a future decision DOES want to kill grants on suspension, it overturns
`sql/120` and must say so. This ADR does not.

## Decision 3 — Running delegated member sessions stop too

A direct consequence of Decision 1: if enforcement is at the chokepoint, nothing
needs to cut sessions. The session stays and every decision it asks for is
refused, exactly the ADR-0073 shape for a suspended tenant.

## How the chokepoint can read it at all

This is the Definition of Ready's first question, and this repo has paid for it
twice already (ADR-0087 and ADR-0088 both planned a cross-tenant read that FORCE
RLS forbids).

`awcms_partners` belongs to the PLATFORM tenant and has FORCE RLS. The chokepoint
runs in the CUSTOMER tenant. It **cannot** read that table — and any plan that
assumes otherwise is wrong before it is written.

Three routes, and two are rejected:

- **Denormalise the status into rows owned by the customer.** The platform cannot
  write customer rows under RLS either, so this demands a per-tenant job — which
  brings back the window Decision 1 refuses, plus two copies that can diverge.
- **Drop FORCE RLS from the registry.** Trading tenant isolation for one read.
- **A narrow SECURITY DEFINER function** — the one chosen, and the one `sql/116`'s
  own header already anticipated ("served by a narrow SECURITY DEFINER function,
  precedent `sql/048`").

`awcms_partner_registry_status(p_partner_tenant_id uuid) RETURNS text` answers ONE
question and returns no rows at all. All four `sql/048`/`sql/119` safeguards
apply, with the SAME owner role (`awcms_partner_view`, NOLOGIN, no members) — plus
one extra restriction specific here: it returns **the status text, not a row**, so
no other registry column can leak through it, and there is no `WHERE` its caller
can forget.

**Unknown means REFUSE.** `NULL` (no registry row) is treated the same as
suspended. That is unreachable today — `sql/120`'s FK requires a registered
partner for as long as a grant exists — and precisely because it is unreachable,
choosing fail-closed cannot break anything that is running.

## What REFUSES, and where

| Point                              | What changes                                                                |
| ---------------------------------- | --------------------------------------------------------------------------- |
| chokepoint                         | a `delegated` actor whose partner is not `active` → 403 `PARTNER_SUSPENDED` |
| `POST /access/partner-engagements` | engaging a suspended partner is refused                                     |
| `POST /access/delegated-grants`    | the `EXISTS` predicate inside the INSERT also demands an `active` partner   |

The third one is inside the statement rather than preceding it, for `sql/120`'s
reason: a TypeScript check before the INSERT is TOCTOU; a predicate in the same
statement cannot be.

## Who may suspend

`identity_access.partner_registry.disable` and `.restore`, both
`scope = 'platform'` like their two siblings in `sql/123`. Suspension is a
platform statement about who may be a partner in this deployment — not a
customer's decision about its own tenant, which already has its own name
(`partner_access.configure`, and a customer can cut the connection at any time
without asking anyone).

The `disable`/`restore` actions are reused instead of new `suspend`/`reinstate`
ones: both already exist in `AccessAction`, and `tenant_admin.tenant_lifecycle`
uses the same pair for an action of the same shape.

## Rejected

- **Equating partner suspension with suspending the partner's tenant.** ADR-0073
  already suspends tenants, and that stops the partner being served IN ITS OWN
  TENANT — not in the customer's tenant. It is also far too blunt: the partner
  tenant may well be a paying customer in its own right, and cutting off its
  business because its partnership is in trouble is a punishment aimed at the
  wrong target.
- **Free-text `status`.** The CHECK is widened to exactly two values, not opened
  up. A third value later is one more DROP/ADD CONSTRAINT, in the same PR as its
  reader — `sql/116`'s rule still applies to itself.
