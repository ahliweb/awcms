🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0089-a-partner-is-an-ordinary-tenant.id.md)

# ADR-0089 — A partner is an ordinary tenant: reach is DATA, not permission

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 8 PR 8.1 — the first PR of the last wave.
  Migration `sql/116`.
- **Builds on:**
  [ADR-0053](0053-platform-scoped-permissions.md) (there is no global superadmin;
  cross-tenant power is the `platform` scope, and even that is guarded by two
  independent mechanisms),
  [ADR-0082](0082-an-invitation-carries-its-own-policy.md) (the right shape for
  "someone from outside starts something inside a tenant": the owning tenant
  writes, the token crosses — not the read crossing),
  [ADR-0087](0087-mfa-moves-to-the-principal.md) and
  [ADR-0088](0088-tenant-selection-and-switching.md) (two consecutive PRs whose
  plans assumed a cross-tenant read that FORCE RLS forbids — this ADR
  refuses to be the third).

## Decision

**`ModulePermissionScope` stays `"tenant" | "platform"`. There is no
`partner` value, now or later.** Partnership is modelled as **data**: two
tables, `awcms_partners` and `awcms_partner_managed_tenants`, both
tenant-scoped and FORCE RLS'd like every other table in this repo.

The sentence that must survive verbatim, because the next person will propose a
`partner` value again:

> **`scope` governs who may HOLD a permission; partnership governs WHICH
> OBJECTS it touches.**

Merging the two produces a permission that is **held correctly and executed
against the wrong tenant** — and not one RLS policy will object, because the
actor really is legitimately authenticated somewhere.
That is not a failure that makes a noise; it is a failure that passes every gate.

## Becoming a partner and reaching a tenant are two different questions

That separation is not a refinement; it is what lets this ADR use the existing
`scope` without adding a third value:

| Question                      | Answered by                                                             | Written by                               |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| Who **may become** a partner  | a permission with `scope: "platform"` (ADR-0053, an existing mechanism) | the platform tenant                      |
| Which tenants are **reached** | a row in `awcms_partner_managed_tenants`                                | **the target tenant, in its own tenant** |

The first row is the operator's commercial decision, exactly like the
`awcms_plans` plan catalogue that only a migration can write (ADR-0084). The
second row is the customer's decision about its own tenant. Not one actor can
do both, and that is the whole security of this model.

### The partner registry is PLATFORM tenant data — forced, not chosen

The shape one naturally imagines first is `awcms_partners` with `tenant_id`
= the partner tenant itself: one tenant, one row, "I am a partner".
**Nobody can write that shape.** Under FORCE RLS, the platform tenant acting
with `app.current_tenant_id` = itself cannot insert a row carrying another
tenant's `tenant_id` — its isolation policy refuses, and that is exactly its
job. The only way to write it is for the partner tenant to register itself,
which is self-registration of a commercial partnership.

So the row belongs to the **platform** tenant, and its subject
(`partner_tenant_id`) is another tenant — the shape
`awcms_tenant_status_transitions` (`sql/092`) has used since ADR-0054. One row
lives in one tenant and **names** another; it is never in two places.

The database does not know which tenant holds platform authority — the answer
is env resolution (`lib/tenant/platform-tenant.ts`), not a column — so there is
no CHECK that can pin it. What enforces it is ADR-0053's two independent
mechanisms on the write path, and this PR ships **zero writers**.

## Which side owns the mapping row — and why the plan did not answer it

The Wave 8 plan states that the delegated-access **grant row** is RLS'd on the
**TARGET** tenant, with the reason "the customer's authoritative view". It
does not state the same for the partner→tenant mapping, and that mapping has
**exactly the same** problem: it is a relation between two tenants,
while under FORCE RLS a row has only **one** `tenant_id` that its
policy recognises.

Three possible shapes, and only one survives:

1. **RLS on the partner tenant.** The partner can list its whole book; the
   customer is **blind to who reaches into its own tenant** and therefore cannot
   cut it off. Rejected: that inverts the one asymmetry that is allowed to exist.
2. **Two rows, one on each side.** Every revocation has to find both,
   and its failure is silent and permanent — the same class as the global
   membership projection ADR-0088 rejected and the cross-tenant directory
   ADR-0087 rejected. Rejected.
3. **RLS on the TARGET tenant.** Chosen.

The customer **must** be able to see and revoke every reach into its tenant
without asking anyone's permission, and that is only true when the row lives in
its tenant. The partner's view of its own book is a convenience, not a security
control, and is served through a narrow `SECURITY DEFINER` function
(precedent `sql/048`) **when PR 8.4 gives it a caller** — not in this PR.
A `SECURITY DEFINER` function without a caller is attack surface without
benefit.

One note anyone who writes that function later must read:
`sql/048` documents that under this repo's posture (function owner
NON-superuser, `NOBYPASSRLS`, sql/019–022) **`SECURITY DEFINER` does NOT bypass
RLS.** It works only because of four parts at once — a dedicated NOLOGIN owner
role, an explicit scoped read policy for that role, a fixed column list,
and a locked-down `EXECUTE`. "One definer function is enough" is a misreading
that will produce a function returning zero rows forever.

## The customer initiates. Always

Because the row lives in the target tenant and is written in the target tenant's
context, **there is not a single cross-tenant write in this model.** A partner
cannot insert a row into a tenant it does not already manage — which, if it
could, would be a partner granting itself reach.

The opposite direction (a partner offering itself) is deliberately **not** built
as a write. If it is ever needed, the shape already exists and is not a new one:
ADR-0082 — the side that owns the membership writes its offer in its own
tenant, and what crosses the boundary is a **token**, not a read and not a
write. Stating this now so that its absence reads as a decision, not an
oversight.

## The FK enforces what `SELECT` must not see

`awcms_partner_managed_tenants.partner_tenant_id` references
`awcms_partners (partner_tenant_id)` — the registry's SUBJECT column, not its
owner column. Foreign key checks **bypass RLS**, so a
customer can name a partner whose row it will never be able to read:
the database rejects a row naming a tenant that is not a registered partner,
without ever giving anyone the ability to enumerate the partner list.

That an FK bypasses RLS is usually a **hazard** in this repo — it is what forced
the composite `tenant_id` FK on the office table (#149). Here it is exactly
what is wanted, and the difference is stated so it is not "fixed"
by someone who recognises the pattern but not the reason: the cross-tenant
reference here is **deliberate and the only direction that makes sense**.

The partner name does not need to be denormalised into the mapping row.
`awcms_tenants` is a GLOBAL table without RLS (listed in
`GLOBAL_TABLE_FORBIDDEN_PRIVILEGES`), so the customer can already read the name
of the partner tenant reaching it. Denormalising would create a copy that can go
stale without anyone knowing.

## What lands inert, and the sentence borrowed from ADR-0082

Both tables land **without a single reader in the authorization gate**.

`activeRoleGrants` (ADR-0079) does not read them and **must never be
taught to**: a subject holding a role because some row somewhere calls it a
partner is exactly the second grant path ADR-0079 removed.
That is also why neither is added to `GRANT_TABLES` in
`scripts/access-grant-readers-check.ts` — a file that names them is not reading
authorization.

When PR 8.4 reads them, it may only **NARROW**: the
`/api/v1/partner/**` surface is authorized by the mapping **AND** an active
grant, never by either alone, and the mapping itself never produces
`allowed: true` (cross-wave rule 3). A mapping row is a
precondition, not a grant.

## Consequences

- A permission keeps meaning the same thing wherever it is held. No
  reader of `scope` anywhere needs to change, now or later.
- Revoking a partnership is a one-row `DELETE` in the customer's tenant, and
  afterwards there is no reach left to forget about. Deliberately a **hard
  delete**: a soft-deleted mapping is a row one bug can bring back to
  life, and its history is already answered by `awcms_audit_events`, which has
  its own retention.
- Both tables go into `BOUNDED_BY_DESIGN`, not because writing a descriptor is
  a nuisance, but because there is no traffic path at all that can add
  rows: one is written by the platform tenant, one is written by a customer
  administrator, and both carry a unique index limiting them to one row per pair.
- Adding a third value to `ModulePermissionScope` turns
  `tests/platform-scoped-permissions.test.ts` red, and that test runs in the `check` chain.
  Its claim is tested at the **source** level because that union is a TYPE — it does not
  exist at runtime, so there is no value any behavioural test could inspect —
  and it is paired with an existence assertion so that a rename cannot make it
  pass vacuously (cross-wave rule 4). It is deliberately **not** the 42nd gate
  in the chain: that test file is already where someone touching `scope`
  reads, and a new gate for one union is ceremony, not a control.

## Rejected

- **A `partner` value on `ModulePermissionScope`** — the reasons are above, and
  the refusal is now gated, not merely recorded.
- **A GLOBAL partner table without RLS.** It would become a directory of every
  commercial partnership in this installation, readable by every tenant — the
  same class of artifact as the cross-tenant membership directory rejected by
  ADR-0087, and a fifth global table.
- **A mapping written twice, one row on each side.**
- **A partner-initiated write** into a tenant it does not already manage.
- **Denormalising the partner name** into the mapping row.
- **A `SECURITY DEFINER` function for the partner view in this PR**, before
  anything calls it.
- **A `subject.partnerId` ABAC attribute.** Programme #423 locks in exactly two
  new attributes (`subject.principalKind`, `resource.scopeType`) and a third is
  not opened here.
