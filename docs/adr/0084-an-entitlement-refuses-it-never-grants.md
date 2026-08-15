🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0084-an-entitlement-refuses-it-never-grants.id.md)

# ADR-0084 — An entitlement REFUSES, it never grants

- **Status:** Accepted (2026-08-12).
- **Context:** Issue #423 Wave 5. Migrations `sql/109` (schema + base catalogue),
  `sql/110` (worker privileges), `sql/111` (the first real entitlement). New gate
  `access:entitlement:deny-only:check` (chain 39 → 40).
- **Builds on:**
  [ADR-0053](0053-platform-scoped-permissions.md) (structural gates that must
  not be bypassable by a grant row),
  [ADR-0063](0063-ownership-grants-run-through-the-authorization-chokepoint.md) (the mutation class that
  leaves gates green while the answers are wrong),
  [ADR-0073](0073-suspension-is-a-service-state-not-a-login-state.md) (a control
  that can disable its own remedy is not a control), and
  [ADR-0076](0076-infrastructure-tables-may-hold-lifecycle-descriptors.md)
  (the retention obligation for every new table).

## Decision

Five tables and one refusal branch in `authorizeInTransaction`:
`403 ENTITLEMENT_REQUIRED`, `matchedPolicy: "entitlement_required"`, decided
**after** `module_disabled` and **above** `fetchGrantedPermissionKeys`.

The entitlement layer can only say NO. There is no value shape it can
return that means "yes": every decision function exported by
`domain/entitlement.ts` is typed `EntitlementDenial | null`, and that property is
**machine-checked** by the new gate, not left to review.

This wave **lands inert**: zero modules declare
`requiresEntitlement`, so the branch is unreachable and the SQL statements the
chokepoint emits are the **SAME statements** as before this wave —
not equivalent ones. `tests/entitlement-guard-chain.test.ts` proves it
by comparing the statement text, not by claiming it.

## Why REFUSE and never GRANT

`docs/PROJECT_STATE.md` §4 already carries the refusal that locks this in:
`subject.entitlements` is **rejected** as an ABAC attribute. This ADR is the shape
of that refusal.

If a tenant could write `allow when subject.entitlements contains X`,
then a plan downgrade would refuse via **a different code path with a different sentinel** —
two answers to one question, and the decision log cannot say which
mechanism spoke. Worse: _allow-as-constraint_ semantics mean a
policy that looks like it loosens actually tightens, and vice versa.

The mutation that breaks this property is one line and reads like tidying up:

```diff
-  if (facts.held) return null;
+  if (facts.held) return { allowed: true, ... };
```

Zero behavioural tests go red. The hard failure comes later, when a
call site starts reading `.allowed` — and entitlements become **a second grant
path**, where a tenant is authorized by its invoice rather than by its role. This is exactly
the class ADR-0063 recorded: the mutation that moves the RBAC check above the ABAC block
leaves the entire test suite green.

That is why the gate was born with a **SYNTHETIC probe** — four deliberately
defective sources that the detector must reject. Wave 1 recorded why:
a check proven only by "it found nothing" is not
proven by anything, and the ledger alarm died exactly when the ledger reached
zero.

## Order: after `module_disabled`, above the grant read

**Above `fetchGrantedPermissionKeys`** because that is what distinguishes a structural
gate from a permission-shaped gate (cross-wave rule 1). A
plan wall that a grant row can step over is not a plan wall — and its failure
is invisible until the first grant row that should not exist appears (a restored
backup, one hand-written INSERT, a provisioning path that lost its
`WHERE`).

**After `module_disabled`** because that is a PRODUCT decision, not security. A tenant
that turned OFF ITS OWN module deserves to be told that, not offered an upgrade:
telling someone to pay when the fix is a button they already hold
is a support ticket manufactured by an error message.

`tests/guard-structural-gate-order.test.ts` enforces all five gates at the
SOURCE level, because — cross-wave rule 4 — the claim "X runs before Y" can
be satisfied by the correct arrangement AND by a mutated one, so a behavioural
test cannot tell them apart.

## Three hard exceptions, and why each exists

1. **The platform tenant.** A subscription that lapses must not lock the operator
   out of the control plane where that subscription is fixed. The exact same
   argument is used by ADR-0073 for suspension.

   This axis is deliberately **NOT fail-closed**: a platform tenant that cannot
   be resolved yields `false`, which means the operator is gated like
   anyone else — not everyone being treated as an operator.

2. **`isCore` modules.** `module_management` is the module that switches
   everything back on. A plan wall in front of it is a control that disables its own
   remedy. A declaration on a core module is **not honoured**
   (`requiredEntitlementForModule` returns null) — and because a declaration
   the runtime ignores is worse than no declaration, it also
   turns `modules:compose:check` red instead of staying silent.

3. **Descriptors without `requiresEntitlement`.** This is what makes this wave
   inert, and it is not a flag: absence means "no commercial prerequisite", which
   is exactly what every descriptor means today.

## The catalogue is GLOBAL and cannot be written during a request

The three catalogue tables are listed in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` with
all three write verbs forbidden. The shape's precedent is `awcms_permissions`, but
the reason is harder here.

`awcms_permissions` is read-only because creating a permission during a request is
absurd. These three are read-only because writing them is **escalation**: there is no
`tenant_id` here for a policy to police, so a request path that
holds INSERT on `awcms_plan_entitlements` could give itself any feature
and **not one RLS policy would object**.

The cost is stated, not hidden: creating or changing plan pricing is a
**MIGRATION**, not an admin screen. That is the right shape for this repo — a
template whose plan catalogue is a deployment artifact — and it is the reason
`/admin/subscriptions` (PR 5.4) can assign a tenant to a plan without
ever being able to change that plan's contents.

## Two tenant tables, not one

`awcms_tenant_subscriptions` answers "what is this customer paying for"; it moves
on billing time and the PR 5.2 transition machine is the only writer
of its status. `awcms_tenant_entitlements` answers "what does this customer hold", and
it moves for reasons that are not billing at all: grandfathered
features, migration promises, support concessions.

Merging them makes grandfathering (PR 5.3) indistinguishable from paying —
so a plan downgrade silently revokes a promise nobody recorded
was ever made.

The union of the two is resolved **at request time**, not materialized. An
"effective entitlement" cache was considered and rejected: a plan downgrade that only
takes effect on the next refresh is a control with a window, and that window is
exactly when someone is still reaching what they have stopped paying for.
Reading it is one round trip either way — `resolveModuleAvailability`
folds the whole question into the `awcms_tenant_modules` query the chokepoint
**already** runs — so that cache buys staleness for nothing in return.

## `past_due` and `grace` STILL serve

`ENTITLING_SUBSCRIPTION_STATUSES` contains `trialing`, `active`, `past_due`,
`grace`. Cutting service on the first missed invoice makes the middle rungs
decoration — their whole existence is so the customer keeps being
served while the operator chases the invoice. `suspended` and `cancelled` are
outside that set, and `suspended` is where the ADR-0073 tenant gate
takes over.

That set is **a code constant and must not become a column**: a status set
that a row can redefine is a plan wall that a row can delete.

## What was REJECTED

1. **`subject.entitlements` / `env.planTier` as ABAC attributes** — already
   rejected in PROJECT_STATE §4 and reinforced here; the reasoning is in §"Why
   REFUSE".
2. **Materializing effective entitlements per tenant** — buys staleness without
   saving a round trip.
3. **Subscription history as a table** — an unbounded table masquerading
   as configuration. The history that matters (who moved this tenant to
   which plan, when) is an audit event that already has its own retention.
4. **A plan catalogue writable during a request** — §"The catalogue is GLOBAL".
5. **`requiresEntitlement` as an array of conditions** — a policy language on
   the deny path is how a deny-only gate grows an accidental allow.
   A deployment that needs finer granularity attaches entitlements
   to more MODULES, not to more expressions.
6. **Making this branch fail-closed on the platform tenant axis** — inverted
   deliberately; see exception 1.
7. **A `dataLifecycle` descriptor for all five tables** — age-based purging would
   delete LIVE entitlements. That is not retention, that is a service outage.
   All five go into `BOUNDED_BY_DESIGN` with a per-table reason.

## Consequences

- `MODULE_CONTRACT_VERSION` rises to **3.1.0** (purely additive), paired with a
  `awcms-family-compatibility.yaml` bump.
- The `bun run check` chain becomes **40 segments**.
- The `sql/` table count becomes **109**; five new tables, three of them GLOBAL and
  therefore required to appear TWICE — in `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` and
  in the `security-readiness.ts` privilege map — or `tests/repo-inventory.test.ts`
  goes red from both sides.
- `resolveModuleEnabled` is **kept** alongside
  `resolveModuleAvailability`. Three routes assembling ADR-0063 ownership grants
  call it directly, and putting an entitlement argument into three files that
  have no business resolving it would scatter this decision instead of
  centralizing it — the chokepoint they hand the ownership grant to has
  already decided it.
- PR 5.2 adds `evaluateSubscriptionTransition` (and does NOT call
  `suspendTenant` — that demands `UPDATE` on a root table without RLS for a
  cron role); PR 5.3 adds the grandfathering backfill and the
  **blast-radius** report that must be run BEFORE a descriptor
  declares its first entitlement; PR 5.4 attaches the first real
  entitlement (`tenant_domain` → `custom_domain`) and refuses ZERO tenants.

- **A tenant with no subscription row is on the `is_default` plan** (PR 5.4) —
  the "a missing row is not a decision" convention used by
  `awcms_tenant_modules` since `sql/008`. This replaces the original design that
  WROTE a subscription when a tenant was born: `modules:table-writes:check` rejected it
  because it made `awcms_tenant_subscriptions` written by two modules (ADR-0013 §6).
  The fallback does NOT apply when a subscription row EXISTS but its status does not
  entitle — that case is a lapse, and falling back to the default would silently
  cancel it.

- The `/admin/subscriptions` screen is **split out** of PR 5.4 and not yet built:
  a new permission must be claimed by a screen (`admin:screen-coverage:check`),
  so the admin surface and its permission land together — while attaching
  entitlements adds no permission at all. When it is built, it
  assigns tenants to a plan and can NEVER change a plan's CONTENTS.
